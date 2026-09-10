import React, { useId, useState } from 'react'
import { buildCompanySnapshotSummary } from './companySnapshotSummary.js'
import './company-snapshot-summary.css'

function money(n) {
  return `$ ${Number(n).toLocaleString('pt-BR')}`
}

function Metric({ label, value, hint }) {
  if (value == null) return null
  return (
    <div className="companySnapshotMetric">
      <span className="companySnapshotMetricLabel">{label}</span>
      <strong className="companySnapshotMetricValue">{value}</strong>
      {hint ? <span className="companySnapshotMetricHint">{hint}</span> : null}
    </div>
  )
}

function RosterRow({ label, value }) {
  if (value == null) return null
  return (
    <li className="companySnapshotRosterRow">
      <span>{label}</span>
      <strong>{Number(value).toLocaleString('pt-BR')}</strong>
    </li>
  )
}

/**
 * Faixa compacta “Minha empresa agora”.
 * Somente leitura; não altera compra nem estado da partida.
 */
export default function CompanySnapshotSummary({
  player = null,
  cash = null,
  defaultExpanded = false,
}) {
  const summary = buildCompanySnapshotSummary({ player, cash })
  const panelId = useId()
  const [open, setOpen] = useState(!!defaultExpanded)

  const essentials = [
    summary.cash != null && { label: 'Caixa', value: money(summary.cash) },
    summary.clients != null && { label: 'Clientes', value: Number(summary.clients).toLocaleString('pt-BR') },
    summary.capacity != null && { label: 'Capacidade', value: Number(summary.capacity).toLocaleString('pt-BR') },
    summary.inAttendance != null && {
      label: 'Em atendimento',
      value: Number(summary.inAttendance).toLocaleString('pt-BR'),
    },
    summary.spareCapacity != null && {
      label: 'Capacidade livre',
      value: Number(summary.spareCapacity).toLocaleString('pt-BR'),
    },
  ].filter(Boolean)

  const hasRoster = [
    summary.vendedoresComuns,
    summary.insideSales,
    summary.fieldSales,
    summary.gestores,
    summary.erpLevel,
    summary.mixLevel,
    summary.certifications,
  ].some((v) => v != null)

  if (essentials.length === 0 && !hasRoster) return null

  return (
    <section className="companySnapshot" aria-label="Minha empresa agora">
      <header className="companySnapshotHeader">
        <h3 className="companySnapshotTitle">Minha empresa agora</h3>
        {summary.playerName ? (
          <span className="companySnapshotPlayer">{summary.playerName}</span>
        ) : null}
      </header>

      {essentials.length > 0 ? (
        <div className="companySnapshotEssentials">
          {essentials.map((item) => (
            <Metric key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      ) : null}

      {hasRoster ? (
        <div className="companySnapshotExpand">
          <button
            type="button"
            className="companySnapshotExpandBtn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Ocultar o que já tenho' : 'O que já tenho'}
          </button>
          {open ? (
            <div id={panelId} className="companySnapshotPanel">
              <ul className="companySnapshotRoster">
                <RosterRow label="Vendedores Comuns" value={summary.vendedoresComuns} />
                <RosterRow label="Inside Sales" value={summary.insideSales} />
                <RosterRow label="Canal representantes" value={summary.fieldSales} />
                <RosterRow label="Gestores Comerciais" value={summary.gestores} />
                {summary.erpLevel != null ? (
                  <li className="companySnapshotRosterRow">
                    <span>ERP/Sistemas</span>
                    <strong>Nível {summary.erpLevel}</strong>
                  </li>
                ) : null}
                {summary.mixLevel != null ? (
                  <li className="companySnapshotRosterRow">
                    <span>Mix de Produtos</span>
                    <strong>Nível {summary.mixLevel}</strong>
                  </li>
                ) : null}
              </ul>
              {summary.certifications ? (
                <div className="companySnapshotCerts">
                  <div className="companySnapshotCertsTitle">Certificações</div>
                  <ul>
                    {summary.certifications.map((row) => (
                      <li key={row.type}>
                        <span>{row.label}</span>
                        <strong>{row.certLabels.join(', ')}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {summary.isOpeningSnapshot ? (
        <p className="companySnapshotNote">Situação no momento da abertura desta compra.</p>
      ) : null}
    </section>
  )
}
