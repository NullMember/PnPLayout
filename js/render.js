// Turning a packed layout into pixels, PDF and SVG. All positions are in mm
// from the sheet's top-left corner; angles are clockwise degrees.

const MM_TO_PT = 72 / 25.4;

function pieceHeightMm(piece) {
    return piece.widthMm * piece.front.h / piece.front.w;
}

// Where a piece's back goes so it lines up with the front after duplex
// printing. Long-edge flipping mirrors across the sheet's long axis.
function backPlacement(p, paper, settings) {
    const portrait = paper.w <= paper.h;
    const mirrorX = (settings.flipEdge === 'long') === portrait;
    return mirrorX
        ? { cx: paper.w - p.cx + settings.backOffsetX, cy: p.cy + settings.backOffsetY, angle: -p.angle }
        : { cx: p.cx + settings.backOffsetX, cy: paper.h - p.cy + settings.backOffsetY, angle: 180 - p.angle };
}

// The face's traced outline, placed on the sheet (mm).
function outlineOnSheet(piece, p) {
    const face = piece.front;
    const wMm = piece.widthMm;
    const hMm = pieceHeightMm(piece);
    const rad = (p.angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return face.outline.map(([x, y]) => {
        const lx = (x / face.w - 0.5) * wMm;
        const ly = (y / face.h - 0.5) * hMm;
        return [p.cx + lx * cos - ly * sin, p.cy + lx * sin + ly * cos];
    });
}

function pathData(points, scale = 1, fmt = (v) => +v.toFixed(3)) {
    return points.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x * scale)} ${fmt(y * scale)}`).join(' ') + ' Z';
}

// Composite (face + outline bleed) for a face drawn at the front's size.
function faceComposite(piece, face, bleedMm) {
    return bleedComposite(face, bleedMm * face.w / piece.widthMm);
}

// ---- Preview ---------------------------------------------------------------------

function drawSheetPreview(canvas, sheet, ctxInfo) {
    const { paper, margins, pieces, settings, side, maxWidth } = ctxInfo;
    const k = maxWidth / paper.w; // px per mm
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(paper.w * k * dpr);
    canvas.height = Math.round(paper.h * k * dpr);
    canvas.style.width = `${Math.round(paper.w * k)}px`;
    canvas.style.height = `${Math.round(paper.h * k)}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr * k, dpr * k);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, paper.w, paper.h);

    // Printable area
    ctx.save();
    ctx.strokeStyle = '#c9d3ff';
    ctx.lineWidth = 0.4;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(margins.left, margins.top, paper.w - margins.left - margins.right, paper.h - margins.top - margins.bottom);
    ctx.restore();

    const bleed = settings.bleed;
    sheet.forEach((p) => {
        const piece = pieces.get(p.pieceId);
        if (!piece) return;
        const face = side === 'back' ? piece.back : piece.front;
        if (!face) return;
        const pos = side === 'back' ? backPlacement(p, paper, settings) : p;
        const comp = faceComposite(piece, face, bleed);
        const wMm = piece.widthMm + 2 * bleed;
        const hMm = pieceHeightMm(piece) + 2 * bleed;
        ctx.save();
        ctx.translate(pos.cx, pos.cy);
        ctx.rotate((pos.angle * Math.PI) / 180);
        ctx.drawImage(comp.preview, -wMm / 2, -hMm / 2, wMm, hMm);
        ctx.restore();
    });

    if (side === 'front' && settings.cutOutline) {
        ctx.strokeStyle = '#e03131';
        ctx.lineWidth = 0.3;
        sheet.forEach((p) => {
            const piece = pieces.get(p.pieceId);
            if (!piece) return;
            ctx.stroke(new Path2D(pathData(outlineOnSheet(piece, p))));
        });
    }
}

// ---- PDF ---------------------------------------------------------------------------

function hexToRgb01(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex) || [0, '00', '00', '00'];
    return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Draw an image centred at (cx, cy) mm, rotated clockwise by angle degrees.
function drawCentered(page, image, pageHpt, cxMm, cyMm, wMm, hMm, angle) {
    const w = wMm * MM_TO_PT;
    const h = hMm * MM_TO_PT;
    const cx = cxMm * MM_TO_PT;
    const cy = pageHpt - cyMm * MM_TO_PT;
    const t = (-angle * Math.PI) / 180; // pdf-lib rotates counter-clockwise about the bottom-left corner
    page.drawImage(image, {
        x: cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t),
        y: cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t),
        width: w,
        height: h,
        rotate: PDFLib.degrees(-angle),
    });
}

async function buildPdf(layout, info, onProgress) {
    const { paper, pieces, settings } = info;
    const pdf = await PDFLib.PDFDocument.create();
    const embedded = new Map();
    const embed = async (piece, face) => {
        const key = face === piece.front ? `${piece.id}:f` : `${piece.id}:b`;
        if (!embedded.has(key)) {
            const comp = faceComposite(piece, face, settings.bleed);
            const blob = await PnP.canvasToBlob(comp.canvas, 'image/png');
            embedded.set(key, await pdf.embedPng(await blob.arrayBuffer()));
        }
        return embedded.get(key);
    };

    const Wpt = paper.w * MM_TO_PT;
    const Hpt = paper.h * MM_TO_PT;
    const lineColor = hexToRgb01(settings.cutColor);
    const bleed = settings.bleed;

    for (let s = 0; s < layout.sheets.length; s++) {
        onProgress && onProgress(`Building sheet ${s + 1} of ${layout.sheets.length}…`);
        const sheet = layout.sheets[s];
        const front = pdf.addPage([Wpt, Hpt]);
        for (const p of sheet) {
            const piece = pieces.get(p.pieceId);
            const img = await embed(piece, piece.front);
            drawCentered(front, img, Hpt, p.cx, p.cy, piece.widthMm + 2 * bleed, pieceHeightMm(piece) + 2 * bleed, p.angle);
        }
        if (settings.cutOutline) {
            for (const p of sheet) {
                const piece = pieces.get(p.pieceId);
                front.drawSvgPath(pathData(outlineOnSheet(piece, p), MM_TO_PT), {
                    x: 0,
                    y: Hpt,
                    borderColor: lineColor,
                    borderWidth: settings.cutWidth,
                });
            }
        }

        const withBacks = sheet.filter((p) => pieces.get(p.pieceId).back);
        if (withBacks.length) {
            const back = pdf.addPage([Wpt, Hpt]);
            for (const p of withBacks) {
                const piece = pieces.get(p.pieceId);
                const img = await embed(piece, piece.back);
                const pos = backPlacement(p, paper, settings);
                drawCentered(back, img, Hpt, pos.cx, pos.cy, piece.widthMm + 2 * bleed, pieceHeightMm(piece) + 2 * bleed, pos.angle);
            }
        }
    }
    return pdf.save();
}

// ---- SVG cut file ------------------------------------------------------------------

function buildSvg(sheet, info) {
    const { paper, pieces } = info;
    const paths = sheet.map((p) => {
        const piece = pieces.get(p.pieceId);
        return `  <path d="${pathData(outlineOnSheet(piece, p))}"/>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}mm" height="${paper.h}mm" viewBox="0 0 ${paper.w} ${paper.h}">
 <g fill="none" stroke="#000000" stroke-width="0.25">
${paths.join('\n')}
 </g>
</svg>
`;
}
