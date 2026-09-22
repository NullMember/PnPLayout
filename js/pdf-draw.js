// Low-level pdf-lib drawing helpers: page size constants, color conversion,
// crosshair marks, image/border tiling onto a page, and the page-level
// horizontal flip used for back pages.

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;

function hexToRgb(hex) {
    console.log(`Converting hex color ${hex} to RGB`);
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 256,
        g: parseInt(result[2], 16) / 256,
        b: parseInt(result[3], 16) / 256
    } : null;
}

function drawCrosshair(page, x, y, imgWidth, imgHeight, crosshairLineWidth, crosshairSize, crosshairColor) {
    console.log('Drawing crosshair');
    page.drawLine({
        start: { x: x - crosshairSize, y: y},
        end: { x: x + crosshairSize, y: y},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x, y: y - crosshairSize},
        end: { x: x, y: y + crosshairSize},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x + imgWidth - crosshairSize, y: y},
        end: { x: x + imgWidth + crosshairSize, y: y},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x + imgWidth, y: y - crosshairSize},
        end: { x: x + imgWidth, y: y + crosshairSize},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x - crosshairSize, y: y - imgHeight},
        end: { x: x + crosshairSize, y: y - imgHeight},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x, y: y - imgHeight - crosshairSize},
        end: { x: x, y: y - imgHeight + crosshairSize},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x + imgWidth - crosshairSize, y: y - imgHeight},
        end: { x: x + imgWidth + crosshairSize, y: y - imgHeight},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });

    page.drawLine({
        start: { x: x + imgWidth, y: y - imgHeight - crosshairSize},
        end: { x: x + imgWidth, y: y - imgHeight + crosshairSize},
        thickness: crosshairLineWidth,
        color: PDFLib.rgb(...Object.values(hexToRgb(crosshairColor))),
    });
}

async function drawImagesOnPage(pdfDoc, page, imageArray, dpi, marginTop, marginBottom, marginLeft, marginRight, crosshair, border) {
    console.log('Drawing images on page');
    const PAGE_WIDTH = document.getElementById('paperSize').value === 'A4' ? A4_WIDTH : LETTER_WIDTH;
    const PAGE_HEIGHT = document.getElementById('paperSize').value === 'A4' ? A4_HEIGHT : LETTER_HEIGHT;
    const usableWidth = PAGE_WIDTH - marginLeft - marginRight;
    const usableHeight = PAGE_HEIGHT - marginTop - marginBottom;

    const imgMargin = parseFloat(document.getElementById('marginBetweenImagesInput').value);
    const crosshairLineWidth = parseFloat(document.getElementById('crosshairLineWidth').value);
    const crosshairSize = parseFloat(document.getElementById('crosshairSize').value);
    const crosshairColor = document.getElementById('crosshairColor').value;
    const borderWidth = parseFloat(document.getElementById('borderWidth').value);
    const borderColor = document.getElementById('borderColor').value;

    let imgIndex = 0
    for (let pass = 0; pass < 3; pass++) {
        console.log(`Drawing images on page, pass ${pass}`);
        let x = marginLeft, y = PAGE_HEIGHT - marginTop;
        let rowHeight = 0;
        for (imgIndex = 0; imgIndex < imageArray.length; imgIndex++) {
            console.log(`Drawing image at index ${imgIndex}`);

            let imgFile = new Image();
            imgFile.src = imageArray[imgIndex].src;
            await imgFile.decode();
            const imgWidth = (imgFile.width / dpi) * 72;
            const imgHeight = (imgFile.height / dpi) * 72;
            const imgWidthWithMargin = imgWidth + imgMargin;
            const imgHeightWithMargin = imgHeight + imgMargin;

            if (x + imgWidthWithMargin > usableWidth + marginLeft) {
                x = marginLeft;
                y -= rowHeight;
                rowHeight = 0;

                if (y - imgHeightWithMargin < marginBottom) {
                    break; // Stop adding images to this page
                }
            }

            if (pass == 0){
                if (border) {
                    page.drawRectangle({
                        x: x - borderWidth,
                        y: y - imgHeight - borderWidth,
                        width: imgWidth + 2 * borderWidth,
                        height: imgHeight + 2 * borderWidth,
                        color: PDFLib.rgb(...Object.values(hexToRgb(borderColor))),
                    });
                }
            }
            else if (pass == 1){
                if (crosshair) {
                    drawCrosshair(page, x, y, imgWidth, imgHeight, crosshairLineWidth, crosshairSize, crosshairColor);
                }
            }
            else if (pass == 2){
                const img = imageArray[imgIndex];
                const imgData = await fetch(img.src).then((res) => res.arrayBuffer());
                const pdfImage =
                    img.type === 'image/png'
                        ? await pdfDoc.embedPng(imgData)
                        : await pdfDoc.embedJpg(imgData);
                page.drawImage(pdfImage, {
                    x: x,
                    y: y - imgHeight,
                    width: imgWidth,
                    height: imgHeight,
                });
            }

            x += imgWidth + imgMargin;
            rowHeight = Math.max(rowHeight, imgHeight + imgMargin);
        }
    }
    for (let i = 0; i < imgIndex; i++) {
        imageArray.shift();
    }
    console.log('Finished drawing images on page');
}

async function flipPageHorizontally(pdfDoc, pageIndex) {
    console.log(`Flipping page horizontally at index ${pageIndex}`);
    const pages = pdfDoc.getPages();
    const page = pages[pageIndex].scale(-1, 1);
}
