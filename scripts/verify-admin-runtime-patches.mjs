import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'admin-panel/shared/admin-runtime-ui.js',
  'admin-panel/shared/admin-runtime-navigation.js',
  'admin-panel/shared/admin-runtime-sync.js'
];

let failed = false;
for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    new vm.Script(source, { filename: file });
    console.log(`OK ${file}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}

if (failed) process.exit(1);
