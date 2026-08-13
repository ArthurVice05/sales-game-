import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const requiredBrowserTests = [
  'src/game/__tests__/turnAlternationTest.js',
  'src/game/__tests__/testControlPanel.js',
  'src/game/__tests__/index.js',
]

console.log('Verificando arquivos de teste do jogo:')
let allFilesExist = true
for (const file of requiredBrowserTests) {
  try {
    readFileSync(join(projectRoot, file), 'utf8')
    console.log(`  OK ${file}`)
  } catch {
    allFilesExist = false
    console.error(`  AUSENTE ${file}`)
  }
}

if (!allFilesExist) process.exit(1)

const nodeSuites = [
  'src/data/__tests__/board40Preview.test.mjs',
  'src/game/__tests__/boardVisualCoordinates.test.mjs',
  'src/game/__tests__/gameStats.test.mjs',
  'src/game/__tests__/board40Integration.test.mjs',
  'src/game/__tests__/boardLayoutStability.test.mjs',
  'src/game/__tests__/responsiveLayout.test.mjs',
]

console.log('\nExecutando testes estruturais do tabuleiro:')
const result = spawnSync(process.execPath, ['--test', ...nodeSuites], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status || 1)

console.log('\nTodos os testes de verificação passaram.')
console.log('Validação manual adicional: npm run dev e runAllTests() no console do navegador.')
