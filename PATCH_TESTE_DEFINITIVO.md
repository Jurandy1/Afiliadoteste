# 🧪 PATCH DEFINITIVO: Paginação COMPLETA do mês

**Objetivo:** Aumentar o limite de 50 para 200 páginas pra cobrir TODAS as conversões do período do cliente (01-30/05). Vai consumir TODA a API.

**Tempo:** 15 minutos (5-10 min só de execução)

**Risco:** 🟢 Mínimo (só aumenta o limite)

---

## ⚠️ ATENÇÃO

Esse teste vai fazer ~120 chamadas consecutivas à API Shopee. Pode levar 3-5 minutos pra terminar.

---

## MUDANÇA: Aumentar limite de páginas

**Arquivo:** `functions/index.js`  
**Onde:** dentro de `shopeeCanceladosTest`

### Localizar:

```javascript
      while (paginas < 50) { // máximo 50 páginas (5000 pedidos)
```

### Substituir por:

```javascript
      while (paginas < 200) { // máximo 200 páginas (20000 pedidos)
```

E aumentar o timeout. Localizar:

```javascript
    timeoutSeconds: 300,
```

### Substituir por:

```javascript
    timeoutSeconds: 540,  // máximo permitido pelo Firebase
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeCanceladosTest
```

⏳ ~2 min deploy.

---

## 🧪 TESTE

```cmd
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeCanceladosTest" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⏳ **VAI DEMORAR 3-5 MINUTOS.** O curl pode dar timeout — **ignora.** A função continua rodando no background.

### Pra acompanhar progresso

Em outro CMD:
```cmd
firebase functions:log --only shopeeCanceladosTest --lines 20
```

---

## 🎯 O QUE VOU OLHAR

Depois de processar tudo:

```json
"paginas_processadas": 122,  ← TODAS as páginas
"total_conversoes": 12235,    ← Bate com dashboard
"totais": {
  "netCommission": "31000.00",  ← Esperado ~30-33k
  "actualAmount": "636000.00"   ← Deve bater com fat. bruto do dashboard
}
```

### Cenário A: netCommission ≥ R$ 30.000 ✅
**MISSÃO POSSÍVEL.** A diferença entre nosso somatório vs dashboard atual (R$ 24.829) é o que está faltando!

### Cenário B: netCommission ainda fica em ~R$ 24.000
**Mistério.** O sync atual já pega tudo. Vamos investigar.

---

**Aplica, deploya, roda. Em 5 min sabemos a resposta final DEFINITIVA.**
