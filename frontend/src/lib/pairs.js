// Transferência entre contas próprias vira DOIS lançamentos independentes na
// Pluggy, um em cada conta, sem nenhum campo que os ligue. Reconstruímos o par
// por valor oposto + contas diferentes + datas próximas.
//
// É heurística, então só afirmamos o par quando há UM candidato. Dois PIX de
// mesmo valor no mesmo dia ficam sem par em vez de virar uma ligação inventada:
// um destino errado é pior que destino nenhum.

const JANELA_DIAS = 3

const dia = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000

// `account_id` nem sempre viaja no payload; sem fallback, comparar undefined com
// undefined dá "mesma conta" e mata todo par silenciosamente — foi o que aconteceu.
const conta = (t) => t.account_id || t.account_name || ''

/** Map(id -> lançamento do outro lado). Uma passada, indexado por valor. */
export function buildPairIndex(txns) {
  const idx = new Map()
  if (!txns?.length) return idx

  const porValor = new Map()
  for (const t of txns) {
    const v = Math.round(Math.abs(t.signed_amount || 0) * 100)
    if (!v) continue
    if (!porValor.has(v)) porValor.set(v, [])
    porValor.get(v).push(t)
  }

  for (const grupo of porValor.values()) {
    if (grupo.length < 2) continue
    for (const t of grupo) {
      const cands = grupo.filter((x) =>
        x.id !== t.id
        && Math.sign(x.signed_amount) === -Math.sign(t.signed_amount)
        && conta(x) !== conta(t)
        && Math.abs(dia(x.date) - dia(t.date)) <= JANELA_DIAS)
      // ambíguo (mais de um candidato) não vira par
      if (cands.length === 1) idx.set(t.id, cands[0])
    }
  }
  return idx
}

/** {de, para} pelo sinal do lançamento, ou null se não houver par. */
export function fluxo(tx, par) {
  if (!tx || !par) return null
  const saiu = (tx.signed_amount || 0) < 0
  return {
    de: saiu ? tx.account_name : par.account_name,
    para: saiu ? par.account_name : tx.account_name,
    outraData: par.date !== tx.date ? par.date : null,
  }
}
