// Drag & drop / file-picker handling for the Front and Back image dropzones.
// Populates the shared images1 (front) / images2 (back) arrays that the PDF
// generation step (app.js) reads from. Back images are flipped horizontally
// at load time via an offscreen canvas.

const images1 = [];
const images2 = [];

function setupDropZone(dropZone, imageUpload, targetArray, flip = false) {
    dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(event.dataTransfer.files, targetArray, flip);
    });

    dropZone.addEventListener('click', (event) => {
        // Avoid double-triggering the picker when the click originated on
        // the (hidden) file input itself.
        if (event.target === imageUpload) return;
        imageUpload.click();
    });

    imageUpload.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    imageUpload.addEventListener('change', (event) => {
        handleFiles(event.target.files, targetArray, flip);
    });
}

function updateDropZoneCount(dropZoneCountId, count) {
    console.log(`Updating drop zone count for ${dropZoneCountId} to ${count}`);
    const dropZoneCount = document.getElementById(dropZoneCountId);
    dropZoneCount.textContent = `${count} file(s) selected`;
}

function handleFiles(files, targetArray, flip = false) {
    console.log(`Handling files for ${targetArray === images1 ? 'Front' : 'Back'} drop zone. Flip: ${flip}`);
    targetArray.length = 0;
    updateDropZoneCount(targetArray === images1 ? 'dropZone1Count' : 'dropZone2Count', files.length);

    Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (flip) {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(-1, 1);
                    ctx.drawImage(img, -img.width, 0);
                    const flippedSrc = canvas.toDataURL();
                    targetArray.push({ src: flippedSrc, type: file.type, name: file.name });
                } else {
                    targetArray.push({ src: img.src, type: file.type, name: file.name });
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

setupDropZone(
    document.getElementById('dropZone1'),
    document.getElementById('imageUpload1'),
    images1
);
setupDropZone(
    document.getElementById('dropZone2'),
    document.getElementById('imageUpload2'),
    images2,
    true
);
