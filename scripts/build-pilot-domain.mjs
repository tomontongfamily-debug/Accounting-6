import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/error-reduction.ts',import.meta.url),'utf8');
const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
fs.writeFileSync(new URL('../pilot/domain.mjs',import.meta.url),'// Generated from src/error-reduction.ts by scripts/build-pilot-domain.mjs.\n'+result.outputText);
