// Grid mode: cards in even rows and columns, centred in the printable area,
// with crop marks in the margins. Produces the same layout the packer does
// ({ sheets: [[{ pieceId, angle, cx, cy }]], unplaced }), plus the grid used
// for the crop marks.

const CROP_MARK = { offset: 1, length: 5 }; // mm: gap from the bleed edge, mark length

// pieces: Map of pieces (see app.js); settings: readSettings().
function gridLayout(pieces, settings) {
    const list = [...pieces.values()].filter((p) => p.qty > 0);
    const { paper, margins } = settings;
    // Same rule as packing: a card's bleed never reaches another card's edge.
    const gap = Math.max(settings.spacing, settings.bleed);
    const areaW = paper.w - margins.left - margins.right;
    const areaH = paper.h - margins.top - margins.bottom;
    // Every cell fits the largest card; smaller cards sit in the middle of theirs.
    const cardW = Math.max(0, ...list.map((p) => p.widthMm));
    const cardH = Math.max(0, ...list.map((p) => pieceHeightMm(p)));

    const fit = (w, h) => ({
        cols: Math.max(0, Math.floor((areaW + gap) / (w + gap) + 1e-9)),
        rows: Math.max(0, Math.floor((areaH + gap) / (h + gap) + 1e-9)),
    });
    const upright = fit(cardW, cardH);
    // Cards lie on their side only when that fits more and every piece may turn.
    const turned = list.every((p) => p.rotate) ? fit(cardH, cardW) : { cols: 0, rows: 0 };
    const turn = turned.cols * turned.rows > upright.cols * upright.rows;
    const { cols, rows } = turn ? turned : upright;
    const [w, h] = turn ? [cardH, cardW] : [cardW, cardH];
    const perSheet = cols * rows;

    if (!list.length || !perSheet) {
        return { sheets: [], unplaced: Object.fromEntries(list.map((p) => [p.id, p.qty])), grid: null };
    }

    const gridW = cols * w + (cols - 1) * gap;
    const gridH = rows * h + (rows - 1) * gap;
    const x0 = margins.left + (areaW - gridW) / 2;
    const y0 = margins.top + (areaH - gridH) / 2;

    const cards = list.flatMap((p) => Array(p.qty).fill(p.id));
    const sheets = [];
    for (let i = 0; i < cards.length; i += perSheet) {
        sheets.push(cards.slice(i, i + perSheet).map((pieceId, k) => ({
            pieceId,
            angle: turn ? 90 : 0,
            cx: x0 + (k % cols) * (w + gap) + w / 2,
            cy: y0 + Math.floor(k / cols) * (h + gap) + h / 2,
        })));
    }
    return { sheets, unplaced: {}, grid: { cols, rows, w, h, gap, x0, y0 } };
}

// Crop marks for a grid: short lines in the margins lined up with every trim
// edge, starting just outside the bleed. Returns [[x1, y1, x2, y2]] in mm.
function cropMarks(grid, paper, bleed) {
    if (!grid) return [];
    const { cols, rows, w, h, gap, x0, y0 } = grid;
    const xs = new Set();
    const ys = new Set();
    for (let c = 0; c < cols; c++) { xs.add(+(x0 + c * (w + gap)).toFixed(4)); xs.add(+(x0 + c * (w + gap) + w).toFixed(4)); }
    for (let r = 0; r < rows; r++) { ys.add(+(y0 + r * (h + gap)).toFixed(4)); ys.add(+(y0 + r * (h + gap) + h).toFixed(4)); }
    const top = y0 - bleed - CROP_MARK.offset;
    const bottom = y0 + rows * h + (rows - 1) * gap + bleed + CROP_MARK.offset;
    const left = x0 - bleed - CROP_MARK.offset;
    const right = x0 + cols * w + (cols - 1) * gap + bleed + CROP_MARK.offset;
    // Marks stop at the paper edge; none when there's no room at all.
    const marks = [];
    const len = (room) => Math.min(CROP_MARK.length, room);
    xs.forEach((x) => {
        if (len(top) > 0) marks.push([x, top - len(top), x, top]);
        if (len(paper.h - bottom) > 0) marks.push([x, bottom, x, bottom + len(paper.h - bottom)]);
    });
    ys.forEach((y) => {
        if (len(left) > 0) marks.push([left - len(left), y, left, y]);
        if (len(paper.w - right) > 0) marks.push([right, y, right + len(paper.w - right), y]);
    });
    return marks;
}
