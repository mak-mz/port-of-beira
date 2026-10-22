# Port of Beira · versão 2 (Supabase + Vercel)

Site público (`index.html`) e gestor de conteúdos (`admin.html`) da Cornelder de Moçambique, com:

- **Conteúdo partilhado:** o que publicar no CMS aparece para todos os visitantes, em qualquer computador.
- **Ficheiros no Supabase Storage:** imagens, vídeos, PDFs (Berth Plan, Port Position, publicações) e fontes.
- **Mensagens guardadas:** formulário de contacto e canal de denúncias, com leitura reservada aos editores.
- **Login individual:** cada editor entra com o seu email e palavra-passe, com recuperação por email.
- **Lista de editores no CMS:** em Dados e acesso.
- **Histórico:** as últimas 50 publicações ficam guardadas e podem ser repostas.

Sem `config.js` preenchido, tudo funciona em **modo local**, como na versão 1 (palavra-passe inicial `cornelder`).

---

## Conteúdo da pasta

| Ficheiro | Para quê |
|---|---|
| `index.html` | Site público |
| `admin.html` | Gestor de conteúdos (abre em `/admin`) |
| `config.js` | **O único ficheiro a editar**: URL e chave publicável do Supabase |
| `vercel.json` | Configuração da Vercel: endereços limpos, cache e segurança |
| `robots.txt` | Impede os motores de busca de indexar o `/admin` |
| `videos/` | Opcional: vídeos do hero servidos pela Vercel |
| `supabase/01-estrutura.sql` | Cria tabelas, regras de segurança e o bucket de ficheiros |
| `supabase/02-primeiro-editor.sql` | Adiciona o primeiro editor |

---

## Parte A · Supabase (cerca de 10 minutos)

### 1. Criar o projecto

1. Entre em <https://supabase.com/dashboard> e clique em **New project**.
2. Preencha os campos:
   - **Name:** `cornelder-port-of-beira`.
   - **Database password:** gere uma e guarde-a num local seguro.
   - **Region:** a mais próxima disponível, por exemplo *Central EU (Frankfurt)* ou *West EU (London)*.
3. Clique em **Create new project** e aguarde 1 a 2 minutos.

### 2. Criar a estrutura

1. No menu lateral, abra **SQL Editor** e clique em **New query**.
2. Abra `supabase/01-estrutura.sql`, copie **todo** o texto, cole-o e clique em **Run**.
3. Deve aparecer *Success. No rows returned*. Pode correr o ficheiro outra vez sem problema.

### 3. Adicionar o primeiro editor

1. Abra `supabase/02-primeiro-editor.sql` e troque `o.seu.email@cornelder.co.mz` pelo seu email.
2. Cole o texto numa nova query e clique em **Run**.

### 4. Criar a sua conta de acesso

1. Abra **Authentication → Users → Add user → Create new user**.
2. Indique o **mesmo email** do passo 3 e uma palavra-passe com pelo menos 8 caracteres.
3. Marque **Auto Confirm User** e clique em **Create user**.

### 5. Copiar as chaves para o `config.js`

1. Abra **Project Settings → API Keys** e copie a **Publishable key** (começa por `sb_publishable_…`).
   - Se só existir a chave antiga **anon**, também serve.
2. Copie o **Project URL** (`https://xxxxxxxx.supabase.co`). Está em **Project Settings → Data API** ou no botão **Connect**.
3. Abra `config.js` num editor de texto (Bloco de Notas, por exemplo) e preencha:

```js
window.CDM_SUPABASE = {
  url: "https://xxxxxxxx.supabase.co",
  key: "sb_publishable_xxxxxxxxxxxxxxxx"
};
```

> ⚠️ **Nunca** use a chave **secret** nem a **service_role**. A chave publicável pode ser vista por qualquer pessoa: a segurança está nas regras criadas no passo 2.

---

## Parte B · Vercel (cerca de 10 minutos)

> **Plano:** o plano gratuito da Vercel (*Hobby*) é só para uso pessoal e não comercial. Para o site institucional da Cornelder, use o plano **Pro**, ou uma conta *Team* da empresa.

### Opção 1: pelo GitHub, sem usar a linha de comandos (recomendada)

1. Em <https://github.com/new>, crie um repositório privado, por exemplo `port-of-beira`.
2. Clique em **uploading an existing file** e arraste **todos** os ficheiros e pastas desta pasta, incluindo o `config.js` já preenchido. Depois clique em **Commit changes**.
3. Em <https://vercel.com/new>, clique em **Import** no repositório `port-of-beira`.
4. Escolha **Framework Preset: Other**, deixe os comandos de build vazios e clique em **Deploy**.
5. No fim, a Vercel mostra o endereço, por exemplo `https://port-of-beira.vercel.app`.

Cada alteração enviada para o GitHub publica uma nova versão automaticamente.

### Opção 2: pela linha de comandos

Dentro desta pasta, com o Node.js instalado:

```
npx vercel login
npx vercel --prod
```

### Domínio próprio (opcional)

1. Na Vercel, abra **Project → Settings → Domains** e adicione, por exemplo, `www.cornelder.co.mz`.
2. Crie no seu fornecedor de DNS os registos que a Vercel indicar.

---

## Parte C · Ligar os dois

1. No Supabase, abra **Authentication → URL Configuration** e preencha:
   - **Site URL:** `https://port-of-beira.vercel.app/admin` (ou o seu domínio + `/admin`).
   - **Redirect URLs:** adicione o mesmo endereço e, se tiver domínio próprio, também `https://www.cornelder.co.mz/admin`.

   Isto faz com que os links de recuperação de palavra-passe e de convite abram o CMS.
2. Abra `https://…/admin`, entre com o email e a palavra-passe do passo A4 e clique em **Publicar** uma primeira vez.

   Até à primeira publicação, o site mostra o conteúdo original.

### Trazer o conteúdo da versão 1

1. No CMS da versão 1, abra **Dados e acesso → Exportar → Descarregar JSON**.
2. No CMS da versão 2, abra **Dados e acesso → Importar → Escolher ficheiro**.

   As imagens, vídeos e PDFs que estavam embutidos são enviados automaticamente para o Supabase Storage.
3. Reveja e clique em **Publicar**.

---

## Gerir editores

- **Adicionar um colega:** um editor adiciona o email do colega em **Dados e acesso → Editores**. Depois, o colega abre `/admin`, clica em **Criar conta** e confirma o email.
- **Acesso só por convite:** em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. Os colegas passam a ser convidados em **Authentication → Users → Invite user**. O email de convite abre o CMS para definirem a palavra-passe.
- **Palavra-passe esquecida:** na entrada do CMS, use **Esqueci a palavra-passe**.
- **Quem não está na lista de editores** pode iniciar sessão, mas não consegue publicar, carregar ficheiros nem ler mensagens. Esta regra é aplicada pela base de dados.

---

## Limites do plano gratuito do Supabase e recomendações

| Recurso | Plano gratuito |
|---|---|
| Base de dados | 500 MB |
| Ficheiros | 1 GB, até 50 MB por ficheiro |
| Tráfego | 5 GB por mês |

- **Vídeos do hero:** são o maior consumo de tráfego. Para muitos visitantes, coloque-os na pasta `videos/` (servida pela Vercel) e, no CMS, indique o caminho `videos/inicio-01.mp4` em vez de os carregar.
- **Projectos parados:** os projectos gratuitos sem actividade durante 7 dias podem ser pausados. As visitas ao site contam como actividade. Para produção, o plano **Pro** do Supabase elimina esta pausa.
- **Cópias de segurança:** o **Histórico de publicações** guarda as últimas 50 versões. Exporte o JSON de vez em quando como cópia extra.

---

## Resolução de problemas

| Sintoma | Causa provável |
|---|---|
| O CMS pede a palavra-passe `cornelder` | O `config.js` está vazio ou com valores errados (modo local) |
| “Sem ligação ao Supabase” | O URL em `config.js` está errado, ou não há internet |
| “Sem acesso de edição” | O email não está na tabela de editores (passo A3) |
| “Email ou palavra-passe incorrectos” | O utilizador não existe em Authentication → Users, ou a palavra-passe está errada |
| O link de recuperação abre a página errada | Falta o endereço em Authentication → URL Configuration |
| Erro ao carregar um ficheiro | O ficheiro tem mais de 50 MB, ou o formato não é permitido (são aceites JPG, PNG, WebP, GIF, AVIF, MP4, WebM, PDF, WOFF/WOFF2/TTF/OTF) |
