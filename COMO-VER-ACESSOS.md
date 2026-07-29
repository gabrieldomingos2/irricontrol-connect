# 📊 Como ver quem acessou o sistema (passo a passo)

Todo login no sistema (certo ou errado) fica registrado automaticamente com:
**data/hora, IP, localização aproximada (cidade/estado/país), provedor de internet e navegador.**

Os dados ficam no arquivo `backend/arquivos/access_log.db` (SQLite).

---

## ✅ Passo a passo para consultar

### 1. Abra a documentação da API (Swagger)

- **Rodando local:** http://localhost:8000/docs
- **Em produção (Render):** https://irricontrol-connect.onrender.com/docs

### 2. Faça login para pegar o token

1. Procure **`POST /api/v1/auth/login`** na lista
2. Clique nele → botão **"Try it out"**
3. No campo de texto, preencha:
   ```json
   {
     "username": "admin",
     "password": "SUA_SENHA_AQUI"
   }
   ```
4. Clique em **"Execute"**
5. Na resposta, **copie o valor de `access_token`** (o texto longo entre aspas, sem as aspas)

### 3. Autorize com o token

1. Lá no **topo da página**, clique no botão **"Authorize"** 🔓
2. Cole o token no campo
3. Clique em **"Authorize"** e depois **"Close"**

### 4. Consulte os acessos

1. Procure **`GET /api/v1/auth/access-stats`**
2. Clique nele → **"Try it out"** → **"Execute"**
3. Pronto! A resposta mostra tudo:

| Campo | O que significa |
|---|---|
| `total_acessos` | Quantos logins com sucesso já aconteceram |
| `tentativas_falhas` | Quantas vezes erraram a senha |
| `ips_unicos` | Quantos IPs diferentes já entraram |
| `por_dia` | Quantos acessos por dia (últimos 30 dias) |
| `por_ip` | Cada IP: quantas vezes entrou, de onde é, qual provedor |
| `recentes` | Os últimos 50 logins com hora, IP, local e se deu certo |

---

## 💡 Observações importantes

- **"Rede local"** = acesso feito do seu próprio computador (localhost). A cidade real
  só aparece em acessos vindos da internet (produção).
- As datas estão em **UTC** (3 horas a mais que o horário de Brasília).
- **Render zera o histórico a cada deploy** (o disco é apagado). Localmente o
  histórico fica guardado para sempre.
- A localização é **aproximada** (baseada no IP, via ip-api.com). Mostra a cidade
  do provedor de internet, não o endereço exato da pessoa.
- Como todo mundo usa a mesma senha, não dá para saber *quem* é cada pessoa —
  só diferencia por IP/local. Se um dia precisar saber por nome, o caminho é
  criar um usuário/senha para cada pessoa.

---

## 🔧 Dica extra: consultar direto pelo terminal (opcional)

```powershell
# 1. Pegar o token
$resp = Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"username": "admin", "password": "SUA_SENHA_AQUI"}'

# 2. Consultar os acessos
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/auth/access-stats" `
  -Headers @{ Authorization = "Bearer $($resp.access_token)" } | ConvertTo-Json -Depth 5
```

(Para produção, troque `http://localhost:8000` pela URL do Render.)
