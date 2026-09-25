// PnP Layout: piece list, live packing (in a worker), sheet previews, export
// and the shared PnPTools hooks.

const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];

const state = {
    pieces: new Map(), // id -> { id, name, front, back, widthMm, qty, rotate }
    nextId: 1,
    layout: null,      // { sheets: [[{ pieceId, angle, cx, cy }]], unplaced: { pieceId: n } }
    side: 'front',
};

const $ = (id) => document.getElementById(id);
const pieceList = $('pieceList');
const sheetGrid = $('sheetGrid');

function setStatus(message, type = 'info') {
    const status = $('status');
    status.textContent = message;
    status.className = `status ${type}`;
}

function num(id, fallback = 0) {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
}

function readSettings() {
    return {
        paper: { w: num('paperW', 210), h: num('paperH', 297) },
        margins: { top: num('marginTop'), bottom: num('marginBottom'), left: num('marginLeft'), right: num('marginRight') },
        spacing: Math.max(0, num('spacing')),
        cell: parseFloat($('precision').value) || 0.5,
        bleed: Math.max(0, num('bleed')),
        cutOutline: $('cutOutline').checked,
        cutWidth: num('cutWidth', 0.5),
        cutColor: $('cutColor').value,
        flipEdge: $('flipEdge').value,
        backOffsetX: num('backOffsetX'),
        backOffsetY: num('backOffsetY'),
    };
}

// ---- Adding pieces ---------------------------------------------------------------

function defaultWidthMm(face) {
    const dpi = face.dpi || num('defaultDpi', 300) || 300;
    return Math.round((face.w / dpi) * 25.4 * 10) / 10;
}

function addPiece(front, back = null) {
    const piece = {
        id: state.nextId++,
        name: front.file.name.replace(/\.[^.]+$/, ''),
        front,
        back,
        widthMm: defaultWidthMm(front),
        qty: 1,
        rotate: true,
    };
    state.pieces.set(piece.id, piece);
    return piece;
}

async function loadFaces(files) {
    const faces = [];
    for (const file of files) {
        try {
            faces.push(await loadFace(file));
        } catch (err) {
            PnP.toast(err.message, 'error');
        }
    }
    return faces;
}

// Files may carry front/back roles (from other tools or projects). Backs pair
// with fronts in order; a single back is shared by every front.
async function addFiles(files) {
    files = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setStatus(`Loading ${files.length} image(s)…`, 'processing');
    const frontFiles = files.filter((f) => f.pnpRole !== 'back');
    const backFiles = files.filter((f) => f.pnpRole === 'back');
    const fronts = await loadFaces(frontFiles);
    const backs = await loadFaces(backFiles);
    fronts.forEach((face, i) => {
        const back = backs.length === fronts.length ? backs[i] : backs.length === 1 ? backs[0] : null;
        addPiece(face, back);
    });
    if (backs.length > 1 && backs.length !== fronts.length) {
        PnP.toast(`Got ${fronts.length} fronts but ${backs.length} backs, so backs were not attached. Add them per piece.`, 'error');
    }
    renderPieceList();
    schedulePack();
}

// ---- Piece list ------------------------------------------------------------------

function thumb(face) {
    const img = document.createElement('img');
    img.src = face.preview.toDataURL();
    img.alt = '';
    return img;
}

function pickImage(onFile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
    input.click();
}

function renderPieceList() {
    pieceList.innerHTML = '';
    $('pieceCount').textContent = state.pieces.size ? `(${state.pieces.size})` : '';
    $('downloadPdf').disabled = $('downloadSvg').disabled = state.pieces.size === 0;

    if (state.pieces.size === 0) {
        pieceList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🧩</div>
                <div>Add piece images to start. Each piece gets a size and a quantity, then everything is packed onto sheets automatically.</div>
            </div>`;
        return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'piece-toolbar';
    const allBack = document.createElement('button');
    allBack.type = 'button';
    allBack.className = 'btn-secondary btn-small';
    allBack.textContent = 'Set one back for all pieces…';
    allBack.addEventListener('click', () => pickImage(async (file) => {
        const [face] = await loadFaces([file]);
        if (!face) return;
        state.pieces.forEach((p) => { p.back = face; });
        renderPieceList();
        schedulePack();
    }));
    toolbar.append(allBack);
    pieceList.append(toolbar);

    state.pieces.forEach((piece) => {
        const row = document.createElement('div');
        row.className = 'piece';
        row.innerHTML = `
            <div class="piece-faces">
                <div class="piece-face" title="Front"></div>
                <div class="piece-face back" title="Back"></div>
            </div>
            <div class="piece-body">
                <div class="piece-name"></div>
                <div class="piece-fields">
                    <div class="control-group">
                        <label for="pw${piece.id}">Width (mm)</label>
                        <input type="number" id="pw${piece.id}" min="1" step="0.5" data-unit="mm">
                    </div>
                    <div class="control-group">
                        <label for="pq${piece.id}">Quantity</label>
                        <input type="number" id="pq${piece.id}" min="0" step="1">
                    </div>
                    <label class="inline piece-rotate"><input type="checkbox"> Allow rotation</label>
                </div>
                <div class="input-hint piece-size"></div>
            </div>
            <button type="button" class="piece-remove" title="Remove piece" aria-label="Remove piece">✕</button>`;

        row.querySelector('.piece-name').textContent = piece.name;
        row.querySelector('.piece-face').append(thumb(piece.front));

        const backSlot = row.querySelector('.piece-face.back');
        if (piece.back) {
            backSlot.append(thumb(piece.back));
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'piece-face-clear';
            clear.title = 'Remove back';
            clear.setAttribute('aria-label', 'Remove back');
            clear.textContent = '✕';
            clear.addEventListener('click', (e) => {
                e.stopPropagation();
                piece.back = null;
                renderPieceList();
                schedulePack();
            });
            backSlot.append(clear);
        } else {
            backSlot.classList.add('empty');
            backSlot.textContent = '+ Back';
        }
        backSlot.addEventListener('click', () => pickImage(async (file) => {
            const [face] = await loadFaces([file]);
            if (!face) return;
            piece.back = face;
            renderPieceList();
            schedulePack();
        }));

        const width = row.querySelector(`#pw${piece.id}`);
        const qty = row.querySelector(`#pq${piece.id}`);
        const rotate = row.querySelector('.piece-rotate input');
        const size = row.querySelector('.piece-size');
        const showSize = () => {
            size.textContent = `${PnP.units.format(piece.widthMm)} × ${PnP.units.format(pieceHeightMm(piece))}`;
        };
        width.value = piece.widthMm;
        qty.value = piece.qty;
        rotate.checked = piece.rotate;
        showSize();
        width.addEventListener('input', () => {
            const v = parseFloat(width.value);
            if (v > 0) { piece.widthMm = v; showSize(); schedulePack(); }
        });
        qty.addEventListener('input', () => {
            piece.qty = Math.max(0, Math.round(parseFloat(qty.value) || 0));
            schedulePack();
        });
        rotate.addEventListener('change', () => { piece.rotate = rotate.checked; schedulePack(); });
        row.querySelector('.piece-remove').addEventListener('click', () => {
            state.pieces.delete(piece.id);
            renderPieceList();
            schedulePack();
        });
        pieceList.append(row);
    });

    PnP.units.scan(pieceList);
    PnP.units.relabel(pieceList);
}

// ---- Packing -----------------------------------------------------------------------

let packTimer = null;
let packSeq = 0;
let worker = null;

function schedulePack() {
    clearTimeout(packTimer);
    packTimer = setTimeout(runPack, 200);
}

function getWorker() {
    if (worker) return worker;
    try {
        worker = new Worker('js/pack-worker.js');
    } catch (err) {
        worker = null; // e.g. opened from file:// — pack on the main thread instead
    }
    return worker;
}

function packJob(settings) {
    const { paper, margins, cell } = settings;
    const W = Math.floor(paper.w / cell);
    const H = Math.floor(paper.h / cell);
    // The gap never drops below the bleed, so one piece's bleed can't reach another's outline.
    const gap = Math.max(settings.spacing, settings.bleed);
    const pad = Math.ceil(gap / 2 / cell);
    const allowed = {
        x0: Math.max(0, Math.ceil(margins.left / cell) - pad),
        y0: Math.max(0, Math.ceil(margins.top / cell) - pad),
        x1: Math.min(W, Math.floor((paper.w - margins.right) / cell) + pad),
        y1: Math.min(H, Math.floor((paper.h - margins.bottom) / cell) + pad),
    };
    const items = [];
    state.pieces.forEach((piece) => {
        if (piece.qty <= 0) return;
        const angles = piece.rotate ? ROTATIONS : [0];
        items.push({
            key: piece.id,
            count: piece.qty,
            footprints: buildFootprints(piece.front, piece.widthMm, pieceHeightMm(piece), cell, pad, angles),
        });
    });
    return { W, H, allowed, items };
}

function runPack() {
    const seq = ++packSeq;
    const settings = readSettings();
    if (state.pieces.size === 0) {
        state.layout = null;
        renderSheets();
        setStatus('Add pieces to get started', 'info');
        return;
    }
    setStatus('Packing…', 'processing');

    let job;
    try {
        job = packJob(settings);
    } catch (err) {
        console.error(err);
        setStatus(`Error: ${err.message}`, 'error');
        return;
    }

    const done = (result) => {
        if (seq !== packSeq) return; // a newer run superseded this one
        state.layout = {
            sheets: result.sheets.map((sheet) => sheet.map((p) => ({
                pieceId: p.key,
                angle: p.angle,
                cx: p.cx * settings.cell,
                cy: p.cy * settings.cell,
            }))),
            unplaced: result.unplaced,
        };
        renderSheets();
        reportLayout(settings);
    };

    const w = getWorker();
    if (!w) {
        setTimeout(() => done(Packer.pack(job)), 0);
        return;
    }
    w.onmessage = (e) => {
        if (e.data.id !== seq) return;
        if (e.data.progress !== undefined) {
            setStatus(`Packing… ${Math.round(e.data.progress * 100)}%`, 'processing');
        } else if (e.data.error) {
            setStatus(`Error: ${e.data.error}`, 'error');
        } else {
            done(e.data.result);
        }
    };
    w.onerror = () => {
        // Worker failed to start (some browsers block workers on file://)
        worker = null;
        w.terminate();
        done(Packer.pack(job));
    };
    w.postMessage({ id: seq, job });
}

function reportLayout(settings) {
    const { sheets, unplaced } = state.layout;
    const placed = sheets.reduce((n, s) => n + s.length, 0);
    const unplacedIds = Object.keys(unplaced);
    if (unplacedIds.length) {
        const names = unplacedIds.map((id) => state.pieces.get(+id)?.name).filter(Boolean).join(', ');
        setStatus(`${placed} piece(s) on ${sheets.length} sheet(s). Too large for the printable area: ${names}.`, 'error');
        return;
    }
    if (!placed) {
        setStatus('Nothing to pack. Set a quantity above 0.', 'info');
        return;
    }
    const { paper, margins } = settings;
    const printable = (paper.w - margins.left - margins.right) * (paper.h - margins.top - margins.bottom);
    let used = 0;
    sheets.forEach((s) => s.forEach((p) => {
        const piece = state.pieces.get(p.pieceId);
        used += piece.front.area * (piece.widthMm / piece.front.w) * (pieceHeightMm(piece) / piece.front.h);
    }));
    const fill = Math.round((used / (printable * sheets.length)) * 100);
    const backs = sheets.filter((s) => s.some((p) => state.pieces.get(p.pieceId).back)).length;
    const pages = sheets.length + backs;
    setStatus(`${placed} piece(s) on ${sheets.length} sheet(s)${backs ? ` + ${backs} back page(s)` : ''} (${pages} PDF page(s)) · ${fill}% of the printable area used`, 'success');
}

// ---- Sheet previews ------------------------------------------------------------------

function renderSheets() {
    sheetGrid.innerHTML = '';
    if (!state.layout || !state.layout.sheets.length) return;
    const settings = readSettings();
    const hasBacks = [...state.pieces.values()].some((p) => p.back);
    $('sideToggle').hidden = !hasBacks;
    const side = hasBacks ? state.side : 'front';
    const maxWidth = Math.min(420, Math.max(220, (sheetGrid.clientWidth - 24) / 2));

    state.layout.sheets.forEach((sheet, i) => {
        const fig = document.createElement('figure');
        fig.className = 'sheet';
        const canvas = document.createElement('canvas');
        drawSheetPreview(canvas, sheet, {
            paper: settings.paper,
            margins: settings.margins,
            pieces: state.pieces,
            settings,
            side,
            maxWidth,
        });
        const cap = document.createElement('figcaption');
        cap.textContent = `Sheet ${i + 1}${side === 'back' ? ' · back' : ''} · ${sheet.length} piece(s)`;
        fig.append(canvas, cap);
        sheetGrid.append(fig);
    });
}

$('sideToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-side]');
    if (!btn) return;
    state.side = btn.dataset.side;
    $('sideToggle').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    renderSheets();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderSheets, 150);
});

// ---- Export ------------------------------------------------------------------------------

function exportInfo() {
    return { paper: readSettings().paper, pieces: state.pieces, settings: readSettings() };
}

function requireLayout() {
    if (!state.layout || !state.layout.sheets.length) {
        PnP.toast('Nothing is packed yet.', 'error');
        return false;
    }
    return true;
}

$('downloadPdf').addEventListener('click', async () => {
    if (!requireLayout()) return;
    const btn = $('downloadPdf');
    btn.disabled = true;
    try {
        const bytes = await buildPdf(state.layout, exportInfo(), (msg) => setStatus(msg, 'processing'));
        PnP.downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'layout.pdf');
        reportLayout(readSettings());
    } catch (err) {
        console.error(err);
        setStatus(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
    }
});

$('downloadSvg').addEventListener('click', async () => {
    if (!requireLayout()) return;
    const info = exportInfo();
    const machineMargin = num('machineMargin');
    if (outlinesInDeadMargin(state.layout.sheets, info, machineMargin)) {
        PnP.toast('Some outlines fall inside the cutting machine’s dead margin and won’t be cut. Widen the paper margins.', 'error');
    }
    const svgs = state.layout.sheets.map((sheet) => buildSvg(sheet, info, machineMargin));
    if (svgs.length === 1) {
        PnP.downloadBlob(new Blob([svgs[0]], { type: 'image/svg+xml' }), 'layout-cut.svg');
    } else {
        const zip = await PnP.zip.create(svgs.map((svg, i) => ({ name: `layout-cut-sheet-${i + 1}.svg`, data: svg })));
        PnP.downloadBlob(zip, 'layout-cut.zip');
    }
});

// ---- Sidebar & shared PnPTools wiring ------------------------------------------------------

// The cutting-machine margin only affects the SVG export, not the packing.
const packUnlessMachine = (e) => { if (!e.target.closest('#machinePanel')) schedulePack(); };
document.querySelector('.sidebar').addEventListener('input', packUnlessMachine);
document.querySelector('.sidebar').addEventListener('change', packUnlessMachine);
PnP.units.onChange(() => renderPieceList());

PnP.dropzone($('dropZone'), {
    input: $('imageInput'),
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    onFiles: addFiles,
});

PnP.bindPreset($('paperSize'), $('paperW'), $('paperH'), 'paper');
PnP.bindMachinePreset($('machinePreset'), $('machineMargin'));

let projectFiles = [];

PnP.init({
    tool: 'PnPLayout',
    offlineFiles: ['js/pack-worker.js'],
    project: {
        getFiles: () => {
            const files = [];
            const index = new Map();
            const add = (face, role) => {
                if (!index.has(face)) {
                    index.set(face, files.length);
                    files.push({ name: face.file.name, blob: face.file, role });
                }
                return index.get(face);
            };
            state.pieces.forEach((p) => { add(p.front, 'front'); if (p.back) add(p.back, 'back'); });
            state.projectIndex = index;
            return files;
        },
        getState: () => ({
            pieces: [...state.pieces.values()].map((p) => ({
                name: p.name,
                widthMm: p.widthMm,
                qty: p.qty,
                rotate: p.rotate,
                front: state.projectIndex.get(p.front),
                back: p.back ? state.projectIndex.get(p.back) : null,
            })),
        }),
        setFiles: (files) => { projectFiles = files; },
        setState: async (saved) => {
            state.pieces.clear();
            if (!saved || !saved.pieces) {
                await addFiles(projectFiles);
                return;
            }
            // Keep indexes aligned with the saved file list even if one fails to load.
            const faces = [];
            for (const file of projectFiles) {
                faces.push((await loadFaces([file]))[0] || null);
            }
            saved.pieces.forEach((s) => {
                const front = faces[s.front];
                if (!front) return;
                const piece = addPiece(front, s.back !== null ? faces[s.back] || null : null);
                Object.assign(piece, { name: s.name, widthMm: s.widthMm, qty: s.qty, rotate: s.rotate });
            });
            renderPieceList();
            schedulePack();
        },
    },
    hasUnsavedWork: () => state.pieces.size > 0,
});

PnP.handoff.receive((items) => addFiles(PnP.itemsToFiles(items)));
