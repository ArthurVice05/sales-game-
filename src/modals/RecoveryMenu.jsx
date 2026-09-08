import React from 'react'
import S from './recoveryStyles'

export default function RecoveryMenu({
  playerName,
  loanAvailable,
  hasPendingLoan,
  hasTakenLoanInMatch,
  loanBlockedInMatch,
  onGoLoan,
  onGoReduce,
  onGoFire,
  onDeclareBankruptcy
}) {
  return (
    <div className="recovery-body" style={S.body}>
      <p style={S.lead}>
        Recuperação financeira: use para recuperar caixa e evitar falência.
        Você está sem dinheiro, {playerName}. Escolha uma das opções:
      </p>

      {loanBlockedInMatch && (
        <div style={{...S.lead, color: '#ef4444', fontWeight: 'bold', marginBottom: '16px'}} className="recovery-alert">
          Cada jogador só pode pegar empréstimo uma única vez por partida.
        </div>
      )}

      <ul style={S.bullets}>
        <li>
          <b>Empréstimo:</b> único na partida, até {`$ ${loanAvailable}`} (50% do valor de compra dos bens). Quita na casa Despesas Operacionais da próxima rodada com 50% de juros. Sem caixa, liquide itens a 50% do valor pago; se não bastar, falência.
        </li>
        <li>
          <b>Reduzir:</b> baixa níveis de MIX ou ERP e recebe 50% do valor pago de volta ao caixa.
        </li>
        <li>
          <b>Demitir:</b> remove colaboradores e recebe 50% do valor — reduz equipe e custos futuros.
        </li>
      </ul>

      <div className="recovery-row-btns" style={S.rowBtns}>
        <button style={{...S.cta, background:'#ef4444'}} onClick={onGoFire}>DEMITIR</button>
        <button style={{...S.cta, background:'#a16207'}} onClick={onGoReduce}>REDUZIR</button>
        <button 
          style={{
            ...S.cta, 
            background: loanBlockedInMatch ? '#6b7280' : '#16a34a',
            cursor: loanBlockedInMatch ? 'not-allowed' : 'pointer'
          }} 
          onClick={loanBlockedInMatch ? undefined : onGoLoan}
          disabled={loanBlockedInMatch}
        >
          {loanBlockedInMatch ? 'EMPRÉSTIMO (INDISPONÍVEL NESTA PARTIDA)' : 'EMPRÉSTIMO'}
        </button>
        <button 
          style={{
            ...S.cta, 
            background:'#d32f2f',
            fontWeight:'bold'
          }} 
          onClick={onDeclareBankruptcy}
        >
          DECLARAR FALÊNCIA
        </button>
      </div>
    </div>
  )
}
