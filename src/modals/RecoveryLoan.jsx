import React, { useMemo, useState } from 'react'
import S from './recoveryStyles'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { loanChargeAmount } from '../game/loanCycle.js'

/**
 * Props
 * - loanAvailable: number      -> limite calculado (50% dos bens)
 * - alreadyHasLoan?: boolean   -> se true, bloqueia novo empréstimo
 * - onBack(): void
 * - onConfirm(payload): void
 *
 * onConfirm(payload) envia um objeto pronto para o chamador aplicar:
 *   {
 *     type: 'LOAN',
 *     amount: <valor>,
 *     // aplique no jogador: cash += amount
 *     cashDelta: <valor>,
 *     // marque para cobrança na casa Despesas Operacionais da próxima rodada
 *     loan: { amount: <valor>, charged: false }
 *   }
 * Caso já exista um empréstimo, envia:
 *   { type:'LOAN_DENIED', reason:'ALREADY_TAKEN' }
 */
export default function RecoveryLoan({
  loanAvailable,
  alreadyHasLoan = false,
  onBack,
  onConfirm
}) {
  const [loanInput, setLoanInput] = useState('')

  const parsed = useMemo(
    () => Math.max(0, Math.floor(Number(loanInput) || 0)),
    [loanInput]
  )
  const canConfirm =
    !alreadyHasLoan && parsed > 0 && parsed <= Number(loanAvailable || 0)
  const interestPct = Math.round((MANUAL_CONSTANTS.loanInterestRatio || 0) * 100)
  const repayAmount = parsed > 0 ? loanChargeAmount({ amount: parsed }) : 0

  const confirm = () => {
    // Bloqueia se já houver empréstimo marcado
    if (alreadyHasLoan) {
      onConfirm?.({ type: 'LOAN_DENIED', reason: 'ALREADY_TAKEN' })
      return
    }

    const limit = Math.max(0, Math.floor(Number(loanAvailable) || 0))
    const val = Math.max(0, Math.min(limit, parsed))

    if (val > 0) {
      // Envia um payload autoexplicativo para o modal pai / App aplicar.
      const payload = {
        type: 'LOAN',
        amount: val,
        cashDelta: val, // somar no saldo imediatamente
        loan: {
          amount: val,
          charged: false // será cobrado na próxima "Despesas Operacionais"
        }
      }
      console.log('[DEBUG] RecoveryLoan enviando payload:', payload)
      onConfirm?.(payload)
    } else {
      onConfirm?.({ type: 'LOAN_DENIED', reason: 'INVALID_AMOUNT' })
    }
  }

  return (
    <div className="recovery-body" style={S.body}>
      <div style={S.subHeader}>
        <b style={{ fontSize: 20 }}>EMPRÉSTIMO</b>
      </div>

      <p>
        Único empréstimo da partida. O banco libera até <b>50% do valor de compra dos seus bens</b> como
        garantia. Na casa <b>Despesas Operacionais da próxima rodada</b> você devolve o valor
        <b> + {interestPct}% de juros</b>.
      </p>
      <p>
        Se não houver caixa para quitar, use o patrimônio: cada item vale
        <b> 50% do valor pago na compra</b>. Se ainda assim não der para pagar e continuar, é falência.
      </p>

      <div style={S.infoRow}>
        <span>Valor disponível:</span> <b>${Number(loanAvailable || 0)}</b>
      </div>
      <div style={S.infoRow}>
        <span>Valor garantia:</span> <b>${Number(loanAvailable || 0)}</b>
      </div>

      {alreadyHasLoan && (
        <div
          style={{
            ...S.infoRow,
            color: '#fca5a5',
            border: '1px solid rgba(255,0,0,.25)',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(255,0,0,.06)'
          }}
        >
          Você já utilizou o empréstimo desta partida. Não é possível pegar outro.
        </div>
      )}

      <input
        style={S.input}
        type="number"
        min={0}
        max={Math.max(0, Number(loanAvailable || 0))}
        placeholder="Digite o valor que quer emprestar"
        value={loanInput}
        onChange={(e) => setLoanInput(e.target.value)}
        disabled={alreadyHasLoan}
      />

      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
        Máx: ${Number(loanAvailable || 0)} — entra no caixa agora. Na próxima rodada
        cobra o valor + {interestPct}% de juros.
      </div>
      {repayAmount > 0 && (
        <div style={{ ...S.infoRow, marginTop: 8 }}>
          <span>A pagar na próxima rodada:</span> <b>${repayAmount}</b>
        </div>
      )}

      <div style={S.rowBtns}>
        <button style={S.back} onClick={onBack}>
          ← Voltar
        </button>
        <button
          style={{
            ...S.cta,
            background: '#16a34a',
            opacity: canConfirm ? 1 : 0.6,
            cursor: canConfirm ? 'pointer' : 'not-allowed'
          }}
          onClick={confirm}
          disabled={!canConfirm}
        >
          Pegar Empréstimo
        </button>
      </div>
    </div>
  )
}
