import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join('D:', 'edgedownloads', 'gemini-svg (1).svg');
const output = path.join(root, 'output', 'gemini-svg-official-icons.svg');
const iconDir = path.join(root, 'output', 'official-icons');

function read(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function svgIcon(file, x, y, width, height, attrs = '') {
  const svg = read(path.join(iconDir, file));
  const inner = svg
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/\s(width|height)="[^"]*"/gi, '')
    .replace(/<svg\b([^>]*)>/i, `<svg x="${x}" y="${y}" width="${width}" height="${height}" $1 ${attrs}>`);
  return inner;
}

function pngIcon(file, x, y, width, height, attrs = '') {
  const bytes = fs.readFileSync(path.join(iconDir, file));
  const data = bytes.toString('base64');
  return `<image href="data:image/png;base64,${data}" x="${x}" y="${y}" width="${width}" height="${height}" ${attrs}/>`;
}

const replacements = new Map([
  ['<image href="https://api.iconify.design/logos:vue.svg" x="15" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_vue_svg.svg', 15, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:vitejs.svg" x="165" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_vitejs_svg.svg', 165, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:pinia.svg" x="315" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_pinia_svg.svg', 315, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:element-plus.svg" x="462" y="12" width="30" height="30"/>', svgIcon('element.svg', 462, 12, 92, 23)],
  ['<image href="https://api.iconify.design/logos:echarts.svg" x="645" y="12" width="30" height="30"/>', svgIcon('https_cdn_simpleicons_org_apacheecharts.svg', 645, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:unrealengine-icon.svg" x="12" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_unrealengine_icon_svg.svg', 12, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:threejs.svg" x="48" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_threejs_svg.svg', 48, 12, 30, 30)],
  ['<image href="https://api.iconify.design/bi:triangle-polygon.svg" x="275" y="15" width="26" height="26" filter="invert(34%) sepia(87%) saturate(2250%) hue-rotate(242deg) brightness(89%) contrast(91%)"/>', svgIcon('vtk.svg', 275, 15, 26, 26)],
  ['<image href="https://api.iconify.design/logos:axios.svg" x="435" y="20" width="35" height="15"/>', svgIcon('https_api_iconify_design_logos_axios_svg.svg', 435, 20, 35, 15)],
  ['<image href="https://api.iconify.design/logos:css-3.svg" x="595" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_css_3_svg.svg', 595, 12, 30, 30)],
  ['<image href="https://api.iconify.design/mdi:cube-outline.svg" x="12" y="13" width="24" height="24" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_cube_outline_svg.svg', 12, 13, 24, 24, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:playlist-check.svg" x="187" y="13" width="24" height="24" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_playlist_check_svg.svg', 187, 13, 24, 24, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:server-network.svg" x="362" y="13" width="24" height="24" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_server_network_svg.svg', 362, 13, 24, 24, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:code-braces.svg" x="572" y="13" width="24" height="24" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_code_braces_svg.svg', 572, 13, 24, 24, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:file-document-outline.svg" x="15" y="72" width="22" height="22" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_file_document_outline_svg.svg', 15, 72, 22, 22, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:palette-outline.svg" x="245" y="72" width="22" height="22" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_palette_outline_svg.svg', 245, 72, 22, 22, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/mdi:folder-outline.svg" x="475" y="72" width="22" height="22" filter="opacity(0.6)"/>', svgIcon('https_api_iconify_design_mdi_folder_outline_svg.svg', 475, 72, 22, 22, 'opacity="0.6"')],
  ['<image href="https://api.iconify.design/logos:postgresql.svg" x="15" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_postgresql_svg.svg', 15, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:redis.svg" x="210" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_redis_svg.svg', 210, 12, 30, 30)],
  ['<image href="https://api.iconify.design/logos:rabbitmq-icon.svg" x="385" y="12" width="30" height="30"/>', svgIcon('https_api_iconify_design_logos_rabbitmq_icon_svg.svg', 385, 12, 30, 30)],
  ['<image href="https://api.iconify.design/mdi:cloud-upload-outline.svg" x="578" y="15" width="26" height="26" filter="invert(46%) sepia(96%) saturate(343%) hue-rotate(94deg) brightness(93%) contrast(85%)"/>', svgIcon('https_api_iconify_design_mdi_cloud_upload_outline_svg.svg', 578, 15, 26, 26)],
  ['<image href="https://api.iconify.design/grommet-icons:spiral.svg" x="15" y="15" width="30" height="30" filter="invert(24%) sepia(91%) saturate(2112%) hue-rotate(222deg) brightness(96%) contrast(91%)"/>', svgIcon('ansys-simple.svg', 15, 18, 40, 18)],
  ['<image href="https://api.iconify.design/mdi:refresh.svg" x="515" y="16" width="28" height="28" filter="invert(58%) sepia(56%) saturate(1982%) hue-rotate(11deg) brightness(101%) contrast(93%)"/>', svgIcon('https_api_iconify_design_mdi_refresh_svg.svg', 515, 16, 28, 28)],
]);

let content = read(source);
for (const [needle, replacement] of replacements) {
  if (!content.includes(needle)) {
    throw new Error(`Missing expected snippet: ${needle}`);
  }
  content = content.replace(needle, replacement);
}

content = content
  .replace('<rect x="450" y="0" width="170" height="55" rx="6" fill="#ffffff" />', '<rect x="450" y="0" width="260" height="55" rx="6" fill="#ffffff" />')
  .replace('<text x="502" y="33" class="node-text">Element Plus 2</text>', '<text x="570" y="33" class="node-text">Element Plus 2</text>')
  .replace('<rect x="635" y="0" width="140" height="55" rx="6" fill="#ffffff" />', '<rect x="725" y="0" width="140" height="55" rx="6" fill="#ffffff" />')
  .replace('<text x="685" y="33" class="node-text">ECharts 6</text>', '<text x="775" y="33" class="node-text">ECharts 6</text>')
  .replace('x="645" y="12" width="30" height="30"  fill="#AA344D" role="img" viewBox="0 0 24 24"', 'x="735" y="12" width="30" height="30"  fill="#AA344D" role="img" viewBox="0 0 24 24"');

fs.writeFileSync(output, content, 'utf8');
console.log(output);
