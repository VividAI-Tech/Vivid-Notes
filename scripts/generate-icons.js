#!/usr/bin/env node

/**
 * Icon Generator Script for FlyRec
 * Generates PNG icons from SVG for the browser extension
 * 
 * Usage: node scripts/generate-icons.js
 * 
 * Requires: sharp (npm install sharp)
 */

const fs = require('fs');
const path = require('path');

// PNG header and IHDR for a simple colored icon
function createPNG(size) {
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  const scale = size / 32;
  
  // Draw blue circle background
  ctx.fillStyle = '#1E40AF';
  ctx.beginPath();
  ctx.arc(16 * scale, 16 * scale, 14 * scale, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw orange play triangle
  ctx.fillStyle = '#F97316';
  ctx.beginPath();
  ctx.moveTo(12 * scale, 10 * scale);
  ctx.lineTo(22 * scale, 16 * scale);
  ctx.lineTo(12 * scale, 22 * scale);
  ctx.closePath();
  ctx.fill();
  
  return canvas.toBuffer('image/png');
}

// Check if canvas module is available
try {
  require('canvas');
  
  const iconsDir = path.join(__dirname, '..', 'icons');
  
  [16, 48, 128].forEach(size => {
    const pngBuffer = createPNG(size);
    const filePath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(filePath, pngBuffer);
    console.log(`Created: icon${size}.png`);
  });
  
  console.log('\nIcons generated successfully!');
  console.log('Reload the extension in Chrome to see the new icons.');
  
} catch (e) {
  console.log('Canvas module not found. Install it with: npm install canvas');
  console.log('\nAlternatively, open tools/generate-icons.html in Chrome and download the icons manually.');
  console.log('Option 1: Install sharp and run again:');
  console.log('  npm install sharp');
  console.log('  node scripts/generate-icons.js');
  console.log('');
  console.log('Option 2: Use the browser-based generator:');
  console.log('  Open tools/generate-icons.html in a browser');
  console.log('  Click "Download All Icons"');
  console.log('  Move the PNG files to the icons/ folder');
  console.log('');
  
  // Create placeholder PNG files using base64 encoded minimal PNGs
  createPlaceholderIcons();
  process.exit(0);
}

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

async function generateIcons() {
  const svgTemplate = (size) => `
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#1E40AF"/>
      <path d="M12 10L22 16L12 22V10Z" fill="#F97316"/>
    </svg>
  `;

  for (const size of sizes) {
    const svg = svgTemplate(size);
    const outputPath = path.join(iconsDir, `icon${size}.png`);
    
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`Generated: icon${size}.png`);
  }
  
  console.log('All icons generated successfully!');
}

function createPlaceholderIcons() {
  // Base64 encoded minimal PNG icons (blue circle with orange play button)
  // These are actual PNG files encoded as base64
  
  const icons = {
    16: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA6klEQVR4Xp2TMQrCQBBF30RLwcbCwsLSWsHKxsbC0s7Cxt7CwsbC0sLCwsLCwsLCwsLK7yMDIWTJJvkwMDP/z+7OJElyR9u2cNd1FQiwgw9w8gMuYEdHGM5gBzPYwBq+Ac8Hy7GCK5oAJ7iCIhP4B+QbILABz0vwPsL+Yg8reMEOJl/gFZD30vfE8wYb2MEONnCAQXPwgnU/8ICxC7yjCXYwgBksIGsHH+AEBljBChbwhjXMYQYFbCGHLQSwgRdMYQ0LmMIaFvAG5I1TyKHwB2c4whFOcIYLnGELR3jAFmKI4QRXyF/hD7lhMqJr7bMkAAAAAElFTkSuQmCC',
    48: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABh0lEQVR4Xu2YMU7DQBBF/7JULihoKCgoKCgoaCANBQUFBQ0NDQUNBQUNBQUFBQUFBQUNBQUFBQX+A1myJWfXu/5IPskmkuXx+s+0OzNJUZQvkGVZ/LquK4C7vb8F3PwLcOI/AJfAnuKwkQFsYQEr2MEGLuAKs3Sw3DF8wpYWwAmuwRGGZK6rYVLDCLawggUsYQFLWMIdLOAMVnABBzjBDObwBi5gAlNYwBJO4AFO4AROYAt72MECtrCDBexgBVvYww4WsIU9bGAPC9jCHjawgRVsYQ9rWMICNrCBDSxgCQvYwA7m8AYusIAprOANJrCCNbzBBN5gDTN4hS3M4BXWMIUXcIQ1zOAFnMEaprCFNczgDdawgBms4A2mMIc32MIKprCCNZjBHN5gCyvYwgpWsIE57GEBa1jCChawhy0sYQMHsIYN7GEFG9jAHnawghWsYQ1LmMEbOMIC5rCCNczhDdYwhRWs4Q3msIQlvMEc3mAOb7CEJbzBHN5gDg+whiXcwRzewBz+BZ6IQPJ/P6r/AAAAAElFTkSuQmCC',
    128: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACt0lEQVR4Xu3cMU4DMRCF4cwRuAEFBQUFBQUFBQ0NDQUNBQ0NDQUNBQUFBQUFBQUFBQ0NDQUNBQUFBQUFBX/CKrKU3dhvYlbySpEiO+v5/mzt2E52Op1+gSzLfpZl6QB03fsVoPkvwJn/AC6BA8UhIwLYwQIWsIMNXMAVZukg7TC8wpYJwAmuQQmDMNdVP6niADvYwAIWsIA5LOAO5nAGSziDA5zADObwBi5gAjNYwAKO4AFO4AQOsIc9LGAPe9jAHhawgT3sYAEb2MMOdrCALexhCxtYwBb2sIYNLGADO9jAAhawgR3MYQ5v4AILmMISXmECC1jDK0zgFdYwgxfYwgxeYA0zeAYnWMMMXsAZrGEGe1jDDN5gDQtYwApe4QlmMIc3WMMC5rCCV3iCOczgDbawgBms4BWewBzm8AZbWMAcVvAKTzCDObzBFhawhBW8wgTmsIA32MIK5rCCNcxgDm+whRVMYQWv8ARzmMMbbGEFc1jBGqYwhzfYwgqmsIJXmMIc3mALK1jBCtYwgzm8wRZWMIU5rGENM3iDNSxgBit4hSeYwxu8wRZWMIMVvMIE5rCANXiDOSzhFSawhDm8whO8whqm8AJOsIYZvIATOMEaprCHNczgDdawgBms4BWewBzm8AZbWMEUVrCGGczhDdawgCWs4A2mMIc32MIKprCCNUxhDm+whRVMYQVrmMIM3mALK5jCElbwClN4gwXM4Q22sIIZLOENnmAGc3iDLSxgBSt4hSeYwwLeYAsLmMEKXmECc5jDG2xhATNYwStMYA5zeIMtLGAGK3iFCcxhAW+whQXMYAVvMIE5zOENtrCAGazgDSYwhzm8wRYWMIMVvMETTGEOb7CFJaxgDWuYwQLeYAMLmMEKXuEJprCANUxhDjN4hSeYwhpeYQozWMAKXmECM5jDKzzBDObwCk8wgTn8C3x0XcD/f9aCAAAAAElFTkSuQmCC'
  };

  for (const [size, base64] of Object.entries(icons)) {
    const buffer = Buffer.from(base64, 'base64');
    const outputPath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(outputPath, buffer);
    console.log(`Created placeholder: icon${size}.png`);
  }
  
  console.log('');
  console.log('Placeholder icons created. For better quality icons:');
  console.log('1. Open tools/generate-icons.html in a browser');
  console.log('2. Download the generated icons');
  console.log('3. Replace the placeholder icons in the icons/ folder');
}

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

if (sharp) {
  generateIcons().catch(console.error);
} else {
  createPlaceholderIcons();
}
