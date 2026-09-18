// src/game/__tests__/gameMath.test.js
import { 
  computeFaturamentoFor, 
  computeDespesasFor, 
  capacityAndAttendance,
  applyDeltas,
  countAlivePlayers,
  findNextAliveIdx
} from '../gameMath.js'

// Helper para criar jogador de teste
const createTestPlayer = (overrides = {}) => ({
  id: 'test-player',
  name: 'Test Player',
  cash: 18000,
  pos: 0,
  clients: 1,
  vendedoresComuns: 1,
  fieldSales: 0,
  insideSales: 0,
  gestores: 0,
  mixProdutos: 'D',
  erpLevel: 'D',
  az: 0,
  am: 0,
  rox: 0,
  ...overrides
})

describe('Game Math Validation', () => {
  describe('computeDespesasFor', () => {
    test('deve calcular manutenção inicial corretamente (manual)', () => {
      const player = createTestPlayer()
      const manutencao = computeDespesasFor(player)
      
      // Vendedor 1000 + Carteira 50 + Mix D 50 + ERP D 50 = 1150
      expect(manutencao).toBe(1150)
    })

    test('deve calcular manutenção com múltiplos vendedores', () => {
      const player = createTestPlayer({
        vendedoresComuns: 3,
        clients: 5
      })
      const manutencao = computeDespesasFor(player)
      
      // Vendedores: 3*1000 + Mix: 5*50 + ERP: 3*50 + Carteira: 5*50 = 3000+250+150+250 = 3650
      expect(manutencao).toBe(3650)
    })

    test('deve calcular manutenção com certificados', () => {
      const player = createTestPlayer({
        vendedoresComuns: 2,
        trainingsByVendor: { comum: ['personalizado'] }, // 1 certificado para vendedores comuns
        clients: 3
      })
      const manutencao = computeDespesasFor(player)
      
      // Base: 1000 + Vendedores: 2*(1000+100) + Mix: 3*50 + ERP: 2*50 = 1000+2200+150+100 = 3450
      expect(manutencao).toBe(3450)
    })

    test('deve calcular manutenção com gestores', () => {
      const player = createTestPlayer({
        gestores: 2,
        clients: 2
      })
      const manutencao = computeDespesasFor(player)
      
      // Vendedor: 1000 + Mix: 2*50 + ERP: 3*50 + Carteira: 2*50 + Gestores: 2*3000 = 1000+100+150+100+6000 = 7350
      expect(manutencao).toBe(7350)
    })
  })

  describe('computeFaturamentoFor', () => {
    test('deve calcular faturamento inicial corretamente', () => {
      const player = createTestPlayer()
      const faturamento = computeFaturamentoFor(player)
      
      // Vendedor Comum: 1*600 + Mix D: 1*100 + ERP D: 1*70 = 600+100+70 = 770
      expect(faturamento).toBe(770)
    })

    test('deve calcular faturamento com múltiplos clientes', () => {
      const player = createTestPlayer({
        clients: 5
      })
      const faturamento = computeFaturamentoFor(player)
      
      // Vendedor: 1*600 + Mix: 5*100 + ERP: 1*70 = 600+500+70 = 1170
      expect(faturamento).toBe(1170)
    })

    test('deve calcular faturamento com certificados', () => {
      const player = createTestPlayer({
        vendedoresComuns: 2,
        trainingsByVendor: { comum: ['personalizado'] }, // 1 certificado para vendedores comuns
        clients: 3
      })
      const faturamento = computeFaturamentoFor(player)
      
      // Vendedores: 2*(600+100) + Mix: 3*100 + ERP: 2*70 = 1400+300+140 = 1840
      expect(faturamento).toBe(1840)
    })

    test('gestor com 0 certificados não dá boost (boost=0)', () => {
      const player = createTestPlayer({
        clients: 0, // evita MIX
        vendedoresComuns: 1,
        gestores: 1,
        trainingsByVendor: { gestor: [] },
      })
      // vendorRevenue=600, cobertura=1, boost=0 => 600; ERP D: staff=2 => 140; total=740
      expect(computeFaturamentoFor(player)).toBe(740)
    })

    test('gestor com 1 certificado dá boost de 20% (boost=0.20)', () => {
      const player = createTestPlayer({
        clients: 0, // evita MIX
        vendedoresComuns: 1,
        gestores: 1,
        trainingsByVendor: { gestor: ['personalizado'] },
      })
      // vendorRevenue=600, cobertura=1, boost=0.20 => 720; ERP D: staff=2 => 140; total=860
      expect(computeFaturamentoFor(player)).toBe(860)
    })
  })

  describe('capacityAndAttendance', () => {
    test('deve calcular capacidade corretamente', () => {
      const player = createTestPlayer({
        vendedoresComuns: 2,
        fieldSales: 1,
        insideSales: 1
      })
      const { cap, inAtt } = capacityAndAttendance(player)
      
      // Vendedores Comuns: 2*2 + Canal Representantes: 1*6 + Inside Sales: 1*5 = 15
      expect(cap).toBe(15)
      expect(inAtt).toBe(1) // min(clients, cap) = min(1, 15) = 1
    })
  })

  describe('applyDeltas', () => {
    test('deve aplicar deltas de clientes corretamente', () => {
      const player = createTestPlayer({ clients: 5 })
      const updated = applyDeltas(player, { clientsDelta: -2 })
      
      expect(updated.clients).toBe(3)
    })

    test('deve aplicar deltas de vendedores corretamente', () => {
      const player = createTestPlayer({ vendedoresComuns: 3 })
      const updated = applyDeltas(player, { vendedoresComunsDelta: -1 })
      
      expect(updated.vendedoresComuns).toBe(2)
    })

    test('deve aplicar deltas de cash corretamente', () => {
      const player = createTestPlayer({ cash: 10000 })
      const updated = applyDeltas(player, { cashDelta: -2000 })
      
      expect(updated.cash).toBe(8000)
    })
  })

  describe('countAlivePlayers', () => {
    test('deve contar jogadores vivos corretamente', () => {
      const players = [
        createTestPlayer({ id: 'p1', bankrupt: false }),
        createTestPlayer({ id: 'p2', bankrupt: true }),
        createTestPlayer({ id: 'p3', bankrupt: false }),
        createTestPlayer({ id: 'p4' }) // sem bankrupt = vivo
      ]
      
      expect(countAlivePlayers(players)).toBe(3)
    })
  })

  describe('findNextAliveIdx', () => {
    test('deve encontrar próximo jogador vivo', () => {
      const players = [
        createTestPlayer({ id: 'p1', bankrupt: false }),
        createTestPlayer({ id: 'p2', bankrupt: true }),
        createTestPlayer({ id: 'p3', bankrupt: false }),
        createTestPlayer({ id: 'p4', bankrupt: true })
      ]
      
      expect(findNextAliveIdx(players, 0)).toBe(2) // próximo ao p1 é p3
      expect(findNextAliveIdx(players, 1)).toBe(2) // próximo ao p2 é p3
      expect(findNextAliveIdx(players, 2)).toBe(0) // próximo ao p3 é p1 (volta)
    })
  })
})
