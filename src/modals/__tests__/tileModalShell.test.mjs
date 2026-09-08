/**
 * Shell visual dos modais de casa — apresentação isolada.
 * Não altera motor, payloads, HUD nem CSS do tabuleiro.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const css = readFileSync(join(root, 'src/modals/tile-modal.css'), 'utf8')
const shell = readFileSync(join(root, 'src/modals/TileModalShell.jsx'), 'utf8')
const base = readFileSync(join(root, 'src/modals/ModalBase.jsx'), 'utf8')
const preview = readFileSync(join(root, 'src/components/PurchaseImpactPreview.jsx'), 'utf8')
const field = readFileSync(join(root, 'src/modals/BuyFieldSalesModal.jsx'), 'utf8')
const luck = readFileSync(join(root, 'src/modals/SorteRevesModal.jsx'), 'utf8')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')
const hudCss = readFileSync(join(root, 'src/components/hud/desktop-hud.css'), 'utf8')

const MODALS = [
  'BuyFieldSalesModal.jsx',
  'InsideSalesModal.jsx',
  'BuyCommonSellersModal.jsx',
  'BuyManagerModal.jsx',
  'BuyClientsModal.jsx',
  'ERPSystemsModal.jsx',
  'MixProductsModal.jsx',
  'TrainingModal.jsx',
  'DirectBuyModal.jsx',
  'SorteRevesModal.jsx',
  'FaturamentoMesModal.jsx',
  'DespesasOperacionaisModal.jsx',
  'InsufficientFundsModal.jsx',
  'RecoveryModal.jsx',
  'BankruptcyModal.jsx',
  'ConfirmModal.jsx',
]

test('tokens do modal de casa têm fallback e não dependem de --hud-*', () => {
  assert.match(css, /\.tileModal\s*\{/)
  assert.match(css, /--tm-text:\s*#f/)
  assert.match(css, /--tm-bg:\s*#0/)
  assert.match(css, /color:\s*var\(--tm-text,\s*#f/)
  assert.match(css, /background:\s*var\(--tm-bg,\s*#0/)
  assert.match(css, /font-family:[\s\S]{0,160}Segoe UI/)
  assert.match(css, /system-ui/)
  assert.doesNotMatch(css, /var\(--hud-/)
  assert.doesNotMatch(css, /transform:\s*scale\(/)
  assert.doesNotMatch(css, /@font-face/)
})

test('shell tem cabeçalho, corpo rolável e rodapé sem backdrop extra', () => {
  assert.match(shell, /tileModalHeader/)
  assert.match(shell, /tileModalBody/)
  assert.match(shell, /tileModalFooter/)
  assert.match(css, /tileModalBody[\s\S]{0,220}overflow-y:\s*auto/)
  assert.match(css, /tileModalBody[\s\S]{0,220}min-height:\s*0/)
  assert.match(css, /tileModalHeader[\s\S]{0,120}flex:\s*0\s+0\s+auto/)
  assert.match(css, /tileModalFooter[\s\S]{0,120}flex:\s*0\s+0\s+auto/)
  assert.doesNotMatch(shell, /rgba\(0,\s*0,\s*0,\s*\.5/)
  assert.doesNotMatch(shell, /position:\s*['\"]fixed['\"]/)
  assert.match(css, /font-size:\s*16px/)
  assert.match(css, /min-height:\s*44px/)
})

test('ModalBase padrão e tabuleiro/HUD não são o veículo desta etapa', () => {
  assert.doesNotMatch(base, /tile-modal\.css/)
  assert.match(base, /background:\s*["']#0f1420["']/)
  assert.doesNotMatch(boardCss, /tileModal/)
  assert.doesNotMatch(hudCss, /tileModal/)
  assert.doesNotMatch(base, /addEventListener\(['\"]keydown['\"]/)
})

test('todas as famílias do escopo usam o shell visual', () => {
  for (const file of MODALS) {
    const src = readFileSync(join(root, 'src/modals', file), 'utf8')
    assert.match(src, /tileModal|TileModalShell/, file)
  }
  assert.match(luck, /const CARDS = SORTE_REVES_CARDS/)
  assert.doesNotMatch(luck, /const CARDS = \[/)
})

test('Field Sales mantém contratos e certificações só informativas', () => {
  assert.match(field, /TileModalShell/)
  assert.match(field, /action:\s*'BUY'/)
  assert.match(field, /action:\s*'SKIP'/)
  assert.match(field, /action:\s*'BACK'/)
  assert.match(field, /InsufficientFundsModal/)
  assert.match(field, /disabled=\{!canBuy\}/)
  assert.doesNotMatch(field, /selectedCert|setSelectedCert|certSelected/)
  assert.match(field, /tileCertCard/)
  assert.doesNotMatch(field, /tileCertCard[\s\S]{0,80}onClick/)
})

test('Sorte & Revés sorteia uma vez e confirma só uma vez', () => {
  assert.match(luck, /useState\(\(\) => CARDS\[/)
  assert.match(luck, /TileModalShell/)
  assert.doesNotMatch(luck, /onClose=\{/)
  assert.match(luck, /didResolveRef/)
  assert.match(luck, /onResolve\?\.\(resolved\.payload\)/)
  assert.doesNotMatch(luck, /array `CARDS`|_compute/)
})

test('Faturamento e Despesas confirmam uma única vez', () => {
  const revenue = readFileSync(join(root, 'src/modals/FaturamentoMesModal.jsx'), 'utf8')
  const expenses = readFileSync(join(root, 'src/modals/DespesasOperacionaisModal.jsx'), 'utf8')
  assert.match(revenue, /didResolveRef/)
  assert.match(expenses, /didResolveRef/)
})

test('preview de impacto expõe colunas sem novas fórmulas', () => {
  assert.match(preview, /Métrica/)
  assert.match(preview, /Atual/)
  assert.match(preview, /Após/)
  assert.match(preview, /Variação/)
  assert.match(preview, /Impacto da contratação/)
  assert.match(preview, /current\.patrimonio/)
  assert.match(preview, /difference\.monthlyNet/)
  assert.doesNotMatch(preview, /previewPurchaseImpact|buildFieldSalesPurchaseDeltas/)
})

test('contratação usa stepper e CTA verde sem seleção de certificação', () => {
  assert.match(css, /\.tileStepper\s*\{/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(field, /tileStepper/)
  assert.match(field, /Contratar por/)
  assert.match(field, /Certificações disponíveis/)
  assert.doesNotMatch(field, /selectedCert|setSelectedCert|certSelected/)
  assert.match(field, /setBoundedQty\(Math\.max\(0,\s*qtyNum - 1\)\)/)
  assert.match(field, /setBoundedQty\(qtyNum \+ 1\)/)
  assert.match(field, /canBuy\s*=\s*qtyNum > 0/)
  assert.match(field, /cashNow < totalHire/)
})

test('Recovery herda tipografia do tileModal e preserva corpo rolável', () => {
  const recovery = readFileSync(join(root, 'src/modals/RecoveryModal.jsx'), 'utf8')
  const styles = readFileSync(join(root, 'src/modals/recoveryStyles.js'), 'utf8')
  assert.match(recovery, /tile-modal\.css/)
  assert.match(recovery, /recovery-card[\s\S]{0,40}tileModal/)
  assert.match(styles, /overflowY:\s*['\"]auto['\"]/)
  assert.match(styles, /minHeight:\s*0/)
  assert.match(styles, /fontSize:\s*16/)
  assert.match(css, /recovery-card\.tileModal/)
  assert.match(base, /variant = 'default'/)
  assert.match(base, /background: isTile \? "transparent"/)
})

test('mobile landscape compacta densidade sem tocar no notebook', () => {
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 500px\)/)
  assert.match(css, /--tm-pad:\s*10px|--tm-pad:\s*8px|padding:\s*8px 10px/)
  assert.match(css, /\.tileModalHeader[\s\S]{0,80}padding/)
  assert.match(css, /\.tileModalBody[\s\S]{0,80}padding/)
  assert.match(css, /\.tileModalFooter[\s\S]{0,80}padding/)
  assert.match(css, /min-height:\s*44px/)
  assert.doesNotMatch(css, /transform:\s*scale\(/)
  assert.doesNotMatch(css, /zoom\s*:/)
  // breakpoints curtos não alteram regras base de padding desktop
  const basePad = css.match(/\.tileModalBody\s*\{[\s\S]*?padding:\s*([^;]+);/)
  assert.ok(basePad, 'padding base do body')
  assert.match(basePad[1], /14px 16px/)
})

test('Direito de Compra e textos sem mojibake nas janelas de casa', () => {
  const direct = readFileSync(join(root, 'src/modals/DirectBuyModal.jsx'), 'utf8')
  const clients = readFileSync(join(root, 'src/modals/BuyClientsModal.jsx'), 'utf8')
  const common = readFileSync(join(root, 'src/modals/BuyCommonSellersModal.jsx'), 'utf8')
  const manager = readFileSync(join(root, 'src/modals/BuyManagerModal.jsx'), 'utf8')
  assert.match(direct, /title="Direito de Compra"/)
  assert.doesNotMatch(direct, /Direto de Compra/)
  assert.match(clients, /Você não possui saldo suficiente/)
  assert.match(common, /Certificações disponíveis/)
  assert.match(manager, /Pagamento único/)
  for (const src of [clients, common, manager, field, direct]) {
    assert.doesNotMatch(src, /VocÃª|NÃ£o comprar|mÃ¡ximo|CertificaÃ§|Pagamento Ãºnico|Direto de Compra/)
  }
})
