// teste-cmd.js
// Rode no CMD usando: node teste-cmd.js

const mockRows = [
  {
    nome_do_item: "Produto Concluído",
    status_do_pedido: "Concluído",
    comissao_liquida: "10,00",
  },
  {
    nome_do_item: "Produto Cancelado",
    status_do_pedido: "Cancelado", // O seu código atual vai ignorar isso
    comissao_liquida: "15,00",
  },
  {
    nome_do_item: "Produto Pendente",
    notas: "Aguardando pagamento", // O seu código atual também vai ignorar isso
    comissao_liquida: "5,00",
  },
];

// Simulando a lógica EXATA do seu shopeeSalesParser.js
function testarNoCMD(rows) {
  let concluidos = 0, cancelados = 0, pendentes = 0;

  for (const row of rows) {
    const statusRaw = row.status_do_pedido ? String(row.status_do_pedido).toLowerCase() : "";
    const notasRaw = row.notas ? String(row.notas).toLowerCase() : "";

    const isInvalid = statusRaw.includes("cancelad") || notasRaw.includes("aguardando pagamento");

    // SE DEIXAR ISSO AQUI, O SISTEMA IGNORA E NÃO CONTA
    // if (isInvalid) continue;

    if (statusRaw.includes("conclu")) {
      concluidos++;
    } else if (statusRaw.includes("cancelad")) {
      cancelados++;
    } else {
      pendentes++;
    }
  }

  console.log("--- RESULTADO DO TESTE NO CMD ---");
  console.log(`Vendas Concluídas: ${concluidos}`);
  console.log(`Vendas Canceladas: ${cancelados}`);
  console.log(`Vendas Pendentes: ${pendentes}`);
}

testarNoCMD(mockRows);
