const fs=require('fs');const p=require('path');
const ico=p.join(__dirname,'..','resources','icon.ico');
if(!fs.existsSync(ico)) console.warn('[ensure-icons] falta resources/icon.ico');
else console.log('[ensure-icons] ok');
