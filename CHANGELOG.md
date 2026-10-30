# Histórico de versões · Port of Beira (site + CMS)

Cornelder de Moçambique · site institucional do Porto da Beira.

**Versão actual: 2.31.0** (30 Out 2026).

## Onde ver a versão

- **No CMS:** no rodapé da barra lateral ("Versão 2.31.0").
- **No site:** no código da página, na etiqueta `<meta name="generator">`.

## Numeração

A numeração segue o padrão **MAIOR.MENOR.CORRECÇÃO**:

- **MAIOR:** mudança de arquitectura. A versão 1 funcionava com conteúdo guardado no navegador ou no artefacto do Claude. A versão 2 usa Supabase e Vercel.
- **MENOR:** funcionalidade nova.
- **CORRECÇÃO:** acerto ou correcção, sem funcionalidade nova.

## Ficheiros afectados

| Sigla | Ficheiro |
|---|---|
| S | `index.html` (site) |
| C | `admin.html` (CMS) |
| B | Supabase (SQL) |
| V | `vercel.json` |
| M | Ficheiros de média |

---

## Versão 2: Supabase + Vercel

### 2.31.0 · 30 Out 2026 · Fotografias dos terminais no plano de atracação
- **Plano de atracação · fotografia de cada terminal:** na linha do tempo, cada cais mostra o seu troço de uma fotografia real do terminal, atrás do nome do cais. **[S, C]**
  - **Terminal de Carga Geral:** uma fotografia para os cais 6 a 10; cada linha mostra só o rectângulo marcado desse cais.
  - **Terminal de Contentores:** cada cais (2 a 5) mostra o seu rectângulo da fotografia, direito (sem rodar), na sua parte da coluna “Ao longo do cais”.
  - As fotografias são sempre **horizontais**, nos dois terminais.
  - A lupa abre a fotografia inteira com todos os cais marcados e o cais escolhido em destaque. Fecha com ×, Esc ou um clique fora.
- **Terminal de Contentores · cais 2 a 5:** a coluna “Ao longo do cais” passa a mostrar os **cais 2, 3, 4 e 5**, cada um à altura dos seus cabeços, com uma linha a separar os cais na linha do tempo. Os cabeços de cada cais indicam-se no CMS; sem eles, o site divide os cabeços do plano em quatro partes iguais. **[S, C]**
- **CMS · Plano de atracação → Cais e fotografias dos terminais:** carregar uma fotografia horizontal por terminal e marcar cada cais como um rectângulo: início (▸) e fim (◂) na horizontal, topo (▾) e base (▴) na vertical, arrastando as marcas ou escrevendo as posições em %. **Mesmo topo e base para todos** copia a altura do primeiro cais para os outros. No CT, indicar também os cabeços de cada cais (do cabeço … ao cabeço …). **Dividir em partes iguais** repõe as marcas. **[C]**
  - Sem fotografia, a linha do tempo fica como antes. O nível Planeamento não vê nem altera as fotografias.

### 2.30.0 · 29 Out 2026 · Desempenho das consultas
- **Inventário e auditoria de todas as consultas** do site, do CMS, das funções e da base de dados (ver *Relatório de consultas 2.30.0*). **[S, C, B]**
- **Menos dados pedidos:** **[S, C]**
  - **Site:** pede só `public_body`, uma cópia do conteúdo sem os dados que só o CMS usa (alertas de notícias, definições de segurança, avisos da revisão do plano de atracação). Ao voltar ao separador, compara só a data da última publicação antes de descarregar de novo.
  - **CMS:** a verificação de 20 em 20 segundos pede só `updated_at`; o conteúdo completo só é descarregado quando alguém publicou. Antes descarregava tudo a cada 20 segundos.
  - **Publicar:** a resposta traz só `updated_at` (antes devolvia o conteúdo inteiro).
  - **Mensagens:** só `id, created_at, kind, data, read` (antes `*`, incluindo o hash do IP). **Tarefas:** só as colunas usadas.
- **Base de dados (`09-desempenho.sql`):** **[B]**
  - Índices em falta: histórico por `saved_at`, cópias por `kind, created_at` e `created_at`, Planeamento por terminal.
  - Visitantes (anon) só podem ler `id, public_body, updated_at` de `site_content`.
  - A regra dos 2 passos lê uma coluna própria (`mfa_all`) em vez de abrir o conteúdo todo do site.
  - **Registo de consultas lentas:** `log_min_duration_statement = 250 ms` para os papéis do site, CMS, funções e tarefas. Cada execução acima do limite fica nos registos do Postgres (Supabase → Logs).
  - **Métricas:** `pg_stat_statements` guardado de hora a hora (pg_cron, 35 dias) no esquema privado `perf`.
- **CMS · Sistema → Desempenho (só administradores):** limite ajustável, período (1 h a 30 dias), consultas acima do limite, quem as corre (site, CMS, funções, tarefas), execuções e execuções por hora, média, máximo, tempo total e % do tempo da base de dados, linhas, memória, leituras de disco, ficheiros temporários e WAL; gráfico hora a hora, por consulta; tabelas e índices sem uso. **[C]**
- **Ordem de instalação:** primeiro os ficheiros no GitHub, depois o SQL 09 (o site novo funciona antes e depois do 09; o antigo deixa de ler o conteúdo depois do 09).

### 2.29.1 · 29 Out 2026 · Segurança (auditoria 2.29.0: S-06 e secção 6)
- **Contas ligadas aos utilizadores do CMS (secção 6 / V-02 da auditoria).** Até agora o nível de cada pessoa era encontrado pelo email da sessão. Uma conta criada por fora, com o email de alguém da lista que ainda não tivesse conta, herdava esse nível. **[B, C, função]**
  - Cada utilizador fica ligado ao **id da sua conta** do Supabase (`editors.user_id`). Os níveis passam a ser procurados por esse id: uma conta criada por fora não tem acesso a nada, mesmo com o email certo.
  - **Criar utilizador** e **Nova palavra-passe** ligam a conta. Se já existia uma conta com esse email, recebe a nova palavra-passe temporária e passa a ser da pessoa indicada.
  - **Dados e acesso → Utilizadores:** nova etiqueta **Conta por ligar** para quem ainda não está ligado; resolve-se com **Nova palavra-passe**.
  - Testado numa base de dados local: contas criadas por fora com o email de uma administradora ou de uma pessoa sem conta ficam sem nível e não conseguem ligar-se a si próprias.
- **SQL `08-contas-ligadas.sql`:** coluna `user_id`, ligação de quem já tem conta e novas `my_role()` e `berth_terminals()`. Correr depois do 07. Se voltar a correr o 05, o 06 ou o 07, corra também o 08. **[B]**
- **Função `cdm-admin` 2.29.1:** liga a conta ao criar e ao dar nova palavra-passe. **Tem de ser publicada de novo.**
- **Função `cdm-feeds` 2.29.1 (S-06):** as Fontes de notícias só são lidas por **https** e em servidores públicos. **[função]**
  - Recusa `localhost`, redes privadas (10.x, 172.16–31.x, 192.168.x, 169.254.x…), IPv6 internos, nomes `.local`/`.internal` e nomes que apontem para redes internas.
  - Cada redireccionamento é verificado da mesma forma (máximo 3); tempo máximo 10 s e 3 MB por página.
  - Os erros mostrados no CMS passam a ser genéricos ("Não foi possível ler esta fonte."); o detalhe fica nos registos (Logs) da função.
  - Opcional: segredo `NEWS_ALLOWED_HOSTS` com a lista de domínios permitidos.
  - Volta a aceitar utilizadores de **Consulta** (alteração da 2.24.0 que não tinha ficado no repositório). O Planeamento continua sem acesso.
  - **Tem de ser publicada de novo.**
- **Supabase (painel):** confirmar Authentication → Sign In / Providers → **Allow new users to sign up: desligado**.

### 2.29.0 · 29 Out 2026
- **Novo nível de acesso: Planeamento.** Para as pessoas que actualizam os planos de atracação diários. **[C, B, função]**
  - Vê no CMS só **Operações portuárias → Plano de atracação** e **A minha conta** (sessão, palavra-passe, verificação em dois passos). Não vê mensagens, denúncias, comentários, alertas, tarefas, histórico, utilizadores nem outras secções.
  - Cada pessoa tem um ou dois terminais (**TCG** e/ou **CT**). Só importa, revê e publica o plano desses terminais. Um PDF de outro terminal é recusado.
  - **Máximo 2 pessoas activas por terminal.** Suspender uma pessoa liberta o lugar.
  - Ao publicar, o CMS envia só o plano desses terminais, sobre a versão publicada mais recente; o resto do site fica como está, mesmo que outra pessoa esteja a editar ao mesmo tempo.
  - **Regras na base de dados, não só no ecrã:** mesmo fora do CMS, uma conta de Planeamento não consegue alterar outra parte do site, o plano de outro terminal, nem carregar ficheiros que não sejam PDF. Também não lê mensagens nem a lista de utilizadores.
  - **Dados e acesso → Utilizadores:** novo nível *Planeamento (planos de atracação)* com a escolha dos terminais e a ocupação de cada um (ex.: TCG 1/2).
  - A verificação em dois passos segue a regra *Exigir a todos*, como para Editores e Consulta.
- **SQL `07-planeamento-atracacao.sql`:** tem de ser corrido no SQL Editor, depois do 06. Se voltar a correr o 05 ou o 06, corra também o 07. **[B]**
- **Função `cdm-admin` 2.29.0:** aceita o nível Planeamento e os terminais. **Tem de ser publicada de novo.**
- **Instalações portuárias:** as caixas de números (comprimento do cais, profundidade, gruas…) deixam de ficar por cima do topo da página. Passam a ficar logo abaixo, no computador e no telemóvel. **[S]**

### 2.28.1 · 29 Out 2026
- **Plano de atracação · identificação dos PDF:** todos os PDF descarregados nesta secção levam o nome do porto, o terminal e a data do plano, no nome do ficheiro e no próprio documento, em EN ou PT conforme a língua do site. **[S]**
  - **Nome do ficheiro:** `Porto_Plano_Terminal[_Navio]_AAAA-MM-DD.pdf`. Ex.: `Port-of-Beira_Berth-Plan_Container-Terminal_2026-10-28.pdf`, `Porto-da-Beira_Plano-de-Atracacao_Terminal-de-Carga-Geral_MV-FLOURISH_2026-10-28.pdf`.
  - **Plano original:** o botão *Plano original (PDF)* passa a descarregar o ficheiro com o mesmo padrão e o sufixo `_original` (antes abria com o nome dado pela planificação). Se o descarregamento falhar, abre o PDF como antes.
  - **No documento:** cabeçalho de todas as páginas com *Porto da Beira · Plano de Atracação*, o terminal e *Plano de DD Mmm AAAA*. Rodapé com data e hora em que o PDF foi gerado e número da página. Título e palavras-chave do PDF (propriedades do ficheiro) com porto, terminal, navio e data.

### 2.28.0 · 29 Out 2026
- **Plano de atracação · Descarregar PDF:** cada terminal tem o botão **Download PDF / Descarregar PDF**, ao lado do plano original. **[S]**
  - O PDF sai na língua em que o site está (EN ou PT): títulos, datas, estados, tipos de carga e notas. O nome do ficheiro também, ex.: `Berth-Plan-CT-2026-10-28-EN.pdf` ou `Plano-de-Atracacao-CT-2026-10-28-PT.pdf`.
  - **PDF do terminal (A4 horizontal):** cabeçalho CdM, números do plano, linha do tempo (por cais no TCG, por cabeços no CT) com preia-mar diária e marca de *Agora*, legenda e lista completa de navios nas páginas seguintes.
  - **PDF do navio (A4 vertical):** no detalhe de cada navio, o botão **PDF** gera a ficha: dimensões, datas, operações (porões no TCG, contentores e TEU no CT), parqueamento e documentos.
  - Gerado no navegador, em vector (texto seleccionável). A biblioteca jsPDF 2.5.2 fica em `vendor/` e só carrega quando se pede o PDF; respeita a CSP (só scripts do próprio site, com SRI).
  - O PDF mostra o plano completo, sem os filtros da página.
- **Telemóvel:** os separadores dos terminais ocupam a largura toda e o nome já não fica cortado. **[S]**

### 2.27.0 · 29 Out 2026
- **Plano de atracação · Terminal de Contentores:** a página *Plano de Atracação* passa a ter dois separadores, **Carga Geral** e **Contentores**. O site lembra o último separador escolhido. **[S]**
  - **Hoje no terminal (CT):** navios atracados agora e próximas chegadas.
  - **Linha do tempo (CT):** um só cais, com o eixo dos cabeços (bolards). Cada bloco mostra navio, serviço e a cor do próprio plano.
  - **Detalhe do navio (CT):** serviço, cabeços, LOA, calados, ETA/ATA/ETB/ATB/ETC/ETD, descarga e embarque em unidades (20'/40', cheios e vazios) e TEU, booking, desembaraço, janelas de trânsito directo e indirecto, porto anterior e notas do plano.
  - **Marés:** mostradas como estão no plano do CT. Os valores do plano do CT ficam cerca de 8 m acima dos do TCG; confirmar a referência com a planificação.
- **CMS · Importar plano (PDF):** o mesmo botão aceita agora o *TCG Berth Plan* e o *Berth Plan – CT*. O CMS reconhece o terminal e substitui só o plano desse terminal. **[C]**
  - Um cartão por terminal com ficheiro, período, número de janelas, avisos, **No site** e **Remover**.
  - **Rever navios** abre a lista desse terminal. Os navios do CT têm campos próprios: serviço, cabeços, cor do bloco, datas, contentores, booking e trânsitos.
  - **Avisos do CT:** cabeços em falta ou estimados, parcelas de contentores que não somam o total, navio sem carga, viagens repetidas e navios nos mesmos cabeços à mesma hora.
  - Os planos importados na 2.26.0 passam automaticamente para o separador *Carga Geral*.
- **Nota:** os cabeços do CT ainda não correspondem a números de cais. Basta a lista de cabeços de cada cais para os mostrar.

### 2.26.0 · 29 Out 2026
- **Plano de atracação interactivo:** a página *Plano de Atracação* passa a mostrar o plano do Terminal de Carga Geral de forma interactiva, em EN e PT. **[S]**
  - **Hoje no terminal:** para cada cais, o navio atracado (com o progresso da janela de atracação) e o seguinte. Setas para avançar ou recuar dias.
  - **Marés:** curva do dia com preia-mar e baixa-mar, tiradas do próprio plano.
  - **Linha do tempo por cais:** todas as janelas de atracação, com a preia-mar diária, cores por tipo de carga e navios improdutivos tracejados. Filtros por carga, descarga/embarque, agente e pesquisa.
  - **Detalhe do navio:** LOA face ao comprimento do cais, calados face à profundidade, ATA/ETA/ATB, carga por porão, estiva, recebedor ou carregador.
  - **Lista de navios** ordenável, e ligação para o PDF original.
  - Sem plano importado, a página continua a mostrar os PDF e a tabela simples, como antes.
- **CMS · Importar plano (PDF):** em *Plano de atracação*, o botão **Importar plano (PDF)** lê o PDF do *TCG Berth Plan* no próprio navegador (PDF.js já incluído no site): cais, datas, marés e cada bloco de navio. **[C]**
  - Guarda o PDF original no armazenamento e preenche o plano no rascunho. Nada vai para o site antes de **Publicar**.
  - **Revisão:** cada navio fica editável (nome, agente, cais, janela, dimensões, datas, operações e porões). Os avisos mostram o que rever: porões que não somam o total, nome ou carga em falta, viagens repetidas, sobreposições no mesmo cais, valores pouco prováveis. Os avisos só aparecem no CMS.
  - **Mostrar no site** liga ou desliga o plano interactivo sem o apagar. **Remover plano** volta à tabela simples.
  - A tabela simples e os PDF da página passam para a secção recolhida *Documentos PDF e tabela simples*.
- **Nota:** a leitura depende do formato actual do PDF (colunas Quay 6 a 10, uma linha por dia, blocos coloridos). Se o modelo do Excel mudar, a importação pode precisar de ajuste.

### 2.25.1 · 28 Out 2026
- **Verificação em dois passos · código QR:** o código QR não aparecia, porque o Supabase o envia sem codificar e os caracteres "#" das cores cortavam a imagem. O CMS passa a codificá-lo antes de o mostrar. **[C]**
- **SQL 06:** se for corrido antes do 05, mostra uma mensagem clara a pedir o 05 primeiro. **[B]**

### 2.25.0 · 27 Out 2026
- **Verificação em dois passos (app autenticadora):** além da palavra-passe, o CMS pede um código de 6 algarismos do Microsoft Authenticator, Google Authenticator ou outra app. **[C, B, função]**
  - Obrigatória para administradores. "Exigir a todos os utilizadores" (Dados e acesso → Segurança) torna-a obrigatória também para editores e consulta.
  - Aplicada pela base de dados: enquanto o código não é confirmado, as regras de todas as tabelas, ficheiros, cópias e funções recusam o acesso.
  - Activação com código QR na primeira entrada. Os administradores podem "Repor 2 passos" a quem perder o telemóvel. A etiqueta "2 passos" mostra quem já a tem activa.
- **Entrada:** retirado o link "Criar conta". As contas são criadas pelos administradores, no CMS. **[C]**
- **SQL `06-verificacao-dois-passos.sql`:** novas funções `mfa_state`, `mfa_ok`, `my_access`; `is_member`, `is_editor` e `is_admin` passam a exigir a verificação. **Tem de ser corrido no SQL Editor.** **[B]**
- **Função `cdm-admin` 2.25.0:** só aceita administradores com a verificação feita; nova acção "mfareset". **Tem de ser publicada de novo.**
- **Manual do CMS** actualizado (2.3 Verificação em dois passos; 17.2 Definições de autenticação recomendadas).

### 2.24.0 · 27 Out 2026
- **Utilizadores e níveis de acesso no CMS:** em Dados e acesso, os administradores criam, alteram, suspendem e removem utilizadores. **[C, B, função]**
  - Três níveis: **Administrador** (tudo, incluindo utilizadores e cópias), **Editor** (edita e publica) e **Consulta** (só vê mensagens, comentários, alertas e tarefas).
  - A conta é criada no Supabase (Authentication → Users) e o nível fica na tabela `editors`.
  - Palavra-passe temporária gerada (14 caracteres) ou escrita (mínimo 10, sem começar por "cornelder", "porto", "beira"…). Na primeira entrada a pessoa tem de escolher a sua.
  - Não é possível baixar o próprio nível nem ficar sem administrador activo.
  - Nova Edge Function `cdm-admin` (usa a chave de serviço do próprio Supabase; nunca vai para o navegador).
- **Cópias de segurança:** cópia completa (conteúdo, mensagens, tarefas e utilizadores) na tabela `site_backups`. **[C, B]**
  - Automática todos os dias às 02:30 (Maputo) com pg_cron; manual com "Criar cópia agora". Ficam as últimas 30 de cada tipo.
  - Descarregar em JSON ou "Abrir no rascunho" para rever e repor.
- **Fim de sessão automático:** depois de 30 minutos sem actividade (configurável em Dados e acesso → Segurança: 10 min a 2 h, ou nunca). **[C]**
  - Aviso um minuto antes; a actividade em qualquer separador conta.
  - Alterações por publicar ficam guardadas no navegador e podem ser recuperadas ao entrar.
- **SQL `05-utilizadores-e-copias.sql`:** níveis, regras de acesso por nível, cópias e agendamento. **Tem de ser corrido no SQL Editor.** **[B]**
- **Função `cdm-feeds` 2.24.0:** aceita utilizadores de Consulta. **Tem de ser publicada de novo.**
- **Manual do CMS** actualizado para a versão 2.24.0.

### 2.23.0 · 27 Out 2026
- **Vídeos que não tocavam:** quando um vídeo falha, o site tenta de novo uma vez, sem usar a cópia guardada pelo navegador, antes de o tirar da sequência. **[S]**
  - Resolve o caso de o navegador ter guardado um "ficheiro não encontrado" de antes de o vídeo ser carregado.
- **vercel.json:** os ficheiros da pasta `videos/` passam a ser revalidados a cada 10 minutos, em vez de 24 horas. **[repo]**
- **CMS · função cdm-feeds:** quando o CMS não a consegue contactar, mostra o endereço da função e uma tabela com o que cada resposta significa e o que fazer. **[C]**
- **Função `cdm-feeds` 2.23.0:**
  - Abrir o endereço no navegador mostra `"ok": true` e a versão, para confirmar que está publicada.
  - Os erros internos passam a ser devolvidos com uma mensagem, em vez de falharem sem resposta.
  - **Tem de ser publicada de novo no Supabase.**

### 2.22.0 · 27 Out 2026
- **Cartão de cada página:** todas as páginas têm agora a secção "Cartão desta página", com imagem, texto e selo próprios. **[S, C]**
  - Estes campos são usados quando a página aparece em Instalações portuárias.
  - Sem imagem própria, o cartão usa a imagem do topo da página ou a capa do vídeo.
- **Alertas de notícias · fontes:** além do Google Notícias, há uma lista de sites a acompanhar, começando por Fim de Semana (fimdesemana.co.mz). **[C, função]**
  - Em sites WordPress, a função usa a pesquisa do próprio site; nos outros, o RSS ou os títulos da página inicial.
  - O Google Notícias pode ser desligado.
- **Diagnóstico:** os alertas mostram o estado de cada fonte, com o número de notícias e os erros. Os comentários mostram o erro de cada rede. **[C]**
  - Quando o CMS não consegue contactar a função, explica como resolver: desligar a verificação de JWT dessa função no Supabase.
- **Função `cdm-feeds`:**
  - Usa a chave enviada pelo CMS para confirmar que é um editor, o que funciona com as novas chaves `sb_publishable_`.
  - Junta sem repetir os temas de uma mesma notícia.
  - **Tem de ser publicada de novo no Supabase.**

### 2.21.0 · 26 Out 2026
**Site**
- **Notícias na página inicial:** o bloco mostra só as notícias marcadas como "Destaque na página inicial". Já não completa com as restantes; sem destaques, o bloco não aparece. **[S]**
- **Topo das páginas mais alto:** cerca de 490 px no computador e 370 px no telemóvel. **[S, C]**
  - Novos campos "Imagem para telemóvel" e "Parte da imagem sempre visível" (centro, esquerda ou direita) para imagens de fundo.
  - Corrigido: ao passar da página inicial para outra página, o título da página inicial podia substituir o título da página.
- **Vídeos em ordem aleatória:** cada visita começa num vídeo que ainda não abriu essa página, até passarem todos. Antes, com poucos vídeos, o primeiro repetia-se muitas vezes. **[S]**
- **Botão "Vídeo seguinte"** ao lado de pausar/reproduzir. **[S]**
- **Instalações portuárias:** qualquer página pode ser um cartão, e há cartões de "Outras áreas" com título, texto, imagem, selo e link (página ou URL). **[S, C]**

**CMS**
- **Menu lateral:**
  - **Grupos:** Acompanhar, Conteúdo, Operações portuárias, Interacção com visitantes, Aparência e Sistema, com separadores e ícones.
  - **Abrir e fechar:** cada grupo abre e fecha.
  - **Recolher/fixar:** o botão no topo do menu recolhe-o numa barra de ícones, que se abre ao passar o rato, ou fixa-o aberto. A escolha fica guardada.
- **Utilizador na barra de topo:**
  - Mostra as iniciais e o nome, que pode ser alterado.
  - O menu tem o email, "Dados e acesso" e "Terminar sessão" (no modo local, "Bloquear o gestor").
- **Rádio na barra de topo:**
  - Toca as 50 rádios da lista do myTuner para Moçambique, com reproduzir/parar, anterior/seguinte, o nome da rádio a deslizar (marquee), uma lista com pesquisa e o volume.
  - As emissões vêm de radio-browser.info. Algumas rádios não têm emissão online ou só emitem sem ligação segura, e o navegador bloqueia-as.
  - Pode juntar rádios com o endereço da emissão.
- **Comentários nas redes (novo):** comentários do Facebook, Instagram e LinkedIn, do mais recente para o mais antigo. **[C, Supabase]**
  - Inclui filtro por rede, pesquisa, link para a publicação, marca "Novo" e número no menu. Actualiza a cada 15 minutos.
- **Alertas de notícias (novo):** notícias do Google Notícias dos últimos 30 dias, em PT e EN, sobre 8 temas editáveis. **[C, Supabase]**
  - Temas: Cornelder, Cornelder de Moçambique, Porto da Beira, Corredor da Beira, Rodovia (EN6), Marítimo, Linha férrea e Fronteiras.
  - Inclui filtro por tema, pesquisa, marca "Novo" e número no menu. Actualiza a cada 30 minutos.
- **Barra de topo no telemóvel:** mais compacta (só ícones), sem cortar o botão Publicar.
- **Nova Edge Function `supabase/functions/cdm-feeds`** para os comentários e os alertas. Só editores a podem usar, e os tokens das redes ficam nos Secrets do Supabase.

### 2.20.0 · 25 Out 2026
- **Conteúdo actualizado nos ficheiros:** a exportação do CMS de 25 Out 2026 passa a ser o conteúdo de origem do site e do CMS. **[S, C]**
  - Inclui todos os textos, páginas, menus, notícias, publicações, galeria, assistente, banners, vídeos e definições.
  - O conteúdo publicado no Supabase continua a ter prioridade. Esta cópia é o que aparece sem ligação ao Supabase, em modo local e numa instalação nova.
  - Para actualizar de novo no futuro, basta enviar uma nova exportação (Dados e acesso → Exportar).

### 2.19.0 · 25 Out 2026
- **CMS · tarefas em "Por completar" (Visão geral):** pode acrescentar as suas próprias tarefas, além das verificações automáticas. **[C, SQL]**
  - Cada tarefa tem texto editável, prazo opcional e uma caixa para marcar como concluída. As setas ↑ ↓ mudam a ordem e o × apaga (pede confirmação).
  - Os prazos ultrapassados aparecem a vermelho com "Atrasada" e os próximos 3 dias a laranja.
  - As concluídas ficam numa secção recolhida, com o botão "Apagar as concluídas".
  - O número de tarefas por fazer aparece ao lado de "Visão geral" no menu lateral.
  - **Com Supabase:** a lista é partilhada por todos os editores e é privada (a tabela `cms_tasks` só é visível para editores). Não precisa de Publicar: cada alteração fica guardada logo.
  - **Novo ficheiro `supabase/04-tarefas.sql`:** corra-o uma vez no SQL Editor. Até lá, o CMS mostra um aviso no lugar da lista.
  - **Modo local:** as tarefas ficam guardadas no navegador.

### 2.18.0 · 25 Out 2026
- **Galeria por colecções (álbuns):** **[S, C]**
  - **Grelha de colecções:** 4 por linha no computador, 3 em ecrãs médios e 2 no telemóvel.
  - **Cartões:** fotografia de capa, número de fotografias, categoria, data e título.
  - **Página da colecção:** clicar num cartão abre `#gallery~<colecção>`, com o título no topo, a capa como fundo, uma descrição e a grelha de fotografias.
  - **Visualizador ampliado:**
    - Mostra o nome da colecção, a legenda e a posição (ex.: 2 / 3).
    - Navega com setas, com as teclas ← → e deslizando para os lados no telemóvel. Desliza para baixo ou Esc para fechar.
    - Carrega antecipadamente a fotografia anterior e a seguinte.
  - **Filtros por categoria:** aparecem quando há colecções em pelo menos duas categorias. Categorias iniciais: Operações, Eventos, Responsabilidade social e Infra-estruturas, editáveis no CMS.
  - **No CMS:**
    - Categorias bilingues, e colecções com título, categoria, data, descrição e visibilidade.
    - Carregamento de várias fotografias de uma vez, legenda EN/PT por fotografia, ordenação e ★ para escolher a capa.
  - As fotografias da galeria antiga passam automaticamente para a colecção "Geral".
  - O código da galeria está num bloco próprio, com o modelo de dados documentado (`albums`, `galleryCats`).

### 2.17.0 · 25 Out 2026
- **Banner (pop-up) com calendário anual:** em vez de um só banner, pode programar vários ao longo do ano. **[S, C]**
  - **Datas por banner:** "Todos os anos" (repete as mesmas datas e pode atravessar o fim do ano) ou "Só uma vez".
  - **Conteúdo e comportamento por banner:** formato, frequência, atraso, imagens, texto e link próprios.
  - **Calendário visual:** os 12 meses com uma barra colorida por banner e a linha de hoje. Clicar numa barra abre esse banner.
  - **Estado de cada banner:** "A mostrar hoje", "Agendado", "Terminou", "Desligado" ou "Falta imagem ou texto".
  - **Datas coincidentes:** aparece o banner de período mais curto (por exemplo, um feriado dentro de uma campanha do mês). Em caso de empate, vale a ordem da lista.
  - **"+ Datas comemorativas de Moçambique":** acrescenta 9 datas nacionais (1 Jan, 3 Fev, 7 Abr, 1 Mai, 25 Jun, 7 Set, 25 Set, 4 Out, 25 Dez). Ficam desligadas até lhes juntar imagem ou texto.
  - **"Duplicar este banner":** cria uma cópia desligada do banner.
  - O banner da versão 2.16 passa automaticamente para a lista.
- **CMS · Visão geral:** títulos, números e textos em peso médio (500). **[C]**
- **CMS · animação de boas-vindas:** depois de entrar com sucesso, aparece uma animação do porto com o logótipo e "Bem-vindo". **[C]**
  - Um pórtico coloca um contentor no navio, que depois zarpa.
  - Dura cerca de 3 segundos e fecha com um clique ou com Esc.
  - É mais curta e sem movimento para quem reduziu as animações no sistema.
  - Não aparece ao recarregar a página com a sessão já iniciada.

### 2.16.0 · 25 Out 2026
- **Mapa de distâncias:** novo botão **Todas as rotas** (o sexto) que mostra em simultâneo as estradas da Beira para todos os destinos, com as dos outros portos a tracejado. **[S]**
  - O painel lista cada destino com a distância e a vantagem da Beira. Clicar num destino abre-o.
- **Assistente virtual:** a ordem definida no CMS passa a ser respeitada no site logo após publicar, mesmo com o assistente já aberto. **[S, C]**
  - No CMS, as setas ↑ ↓ ficam visíveis em cada pergunta sem a abrir. Cada pergunta mostra o número de ordem e a etiqueta "Sugestão" nas que aparecem ao abrir o assistente.
- **CMS:**
  - **Temperatura da Beira** na barra de topo, actualizada a cada 30 minutos. **[C]**
  - **Sino de mensagens** na barra de topo, com o número de mensagens por ler. **[C]**
    - Verifica mensagens novas a cada 15 minutos e sempre que se volta ao separador do CMS.
    - Quando chega uma mensagem, o sino abana, aparece um aviso e o título do separador mostra o número, por exemplo "(1) Port of Beira CMS". Clicar no sino abre as Mensagens.
- **Banner (pop-up) para ocasiões especiais:** nova secção no CMS. Aparece só na página inicial. **[S, C]**
  - **Formatos:** cartão no canto, que não bloqueia a página (no telemóvel fica em baixo, com a largura do ecrã), ou janela ao centro.
  - **Conteúdo:** imagem (com versão opcional para telemóvel), título, texto e botão com link, em EN e PT.
  - **Datas:** de início e de fim.
  - **Frequência:** uma vez por visita, uma vez por dia, só uma vez ou sempre.
  - **Atraso:** de 0 a 15 segundos.
  - **Fechar:** no ×, fora do banner, com a tecla Esc ou deslizando para baixo no telemóvel.

### 2.15.0 · 25 Out 2026
- **Topo das páginas:** o padrão quadriculado sobre o vídeo, as imagens e o fundo azul foi removido. **[S]**
- **Cena 3D removida:** enquanto o vídeo carrega, aparece a **imagem de capa** em vez da animação 3D. **[S, C]**
  - O vídeo aparece por cima da imagem só quando começa a tocar.
  - Na página inicial, quem tinha "Cena 3D animada" passa automaticamente para Vídeo (se houver vídeos) ou Imagem.
  - A biblioteca three.js deixa de ser carregada: menos 600 KB por visita. O ficheiro `vendor/three-r128.min.js` pode ser apagado do GitHub.
- **Botão pausar/reproduzir no vídeo do topo:** no canto inferior direito, ou no canto superior esquerdo do vídeo em telemóvel. **[S]**
  - A escolha mantém-se enquanto o visitante navega no site.
  - Cumpre a regra de acessibilidade WCAG 2.2.2 (pausar conteúdo em movimento).
- **Página de contactos personalizável:** novo cartão "Aspecto da página de contactos", em Contactos e rodapé. **[S, C]**
  - Cinco estilos prontos: Limpo, Azul CdM, Fotografia, Minimalista e Destaque.
  - Ajustes: disposição, cantos, caixa dos contactos, caixa do formulário, campos, cor do botão, caixas com a mesma altura, círculo decorativo e texto de introdução.
  - O novo aspecto por defeito tem caixas com a mesma altura, campos brancos, botão laranja e nenhum círculo decorativo.
- **Assistente virtual:** um botão laranja no canto do site abre um painel de perguntas frequentes, bilingue, sem custos nem inteligência artificial externa. **[S, C]**
  - Responde por correspondência de palavras com as perguntas e palavras-chave definidas no CMS.
  - Quando não encontra resposta, sugere perguntas próximas ou o formulário de contacto e o telefone.
  - Vem com 9 perguntas iniciais: contactos, plano de atracação, tarifas, posição do porto, distâncias, terminal de contentores, terminal de cereais, denúncias e accionistas.
  - No CMS (secção **Assistente virtual**) pode editar, ordenar, desligar e acrescentar perguntas, e testar o que o assistente responde.

### 2.14.0 · 25 Out 2026
- **Textos uniformes:** todo o texto corrido (páginas, notícias, projectos e localização) segue agora um único padrão de tamanho, entrelinha e espaçamento. **[S]**
  - O texto ocupa toda a largura da coluna e fica alinhado com a grelha de fotografias e com os cartões. Os limites de largura antigos deixam de existir.
  - Os subtítulos (por exemplo, "Who we are", "Our vision") têm o mesmo tamanho em todas as páginas, com espaço acima e abaixo consistente.
- **Correcção automática de formatação:** um parágrafo escrito como título (mais de 90 caracteres) passa a ser mostrado como texto normal. Títulos e parágrafos vazios são removidos. **[S, C]**
  - A correcção também se aplica ao editor do CMS: ao abrir uma página, o texto aparece já como "Parágrafo".

### 2.13.0 · 24 Out 2026
- **Notícias e projectos:** cada artigo passa a ter a sua **grelha de fotografias**. **[S, C]**
  - No site, a grelha aparece por baixo do texto do artigo, com mosaico ou três iguais, rotação com mais de 3 fotografias (até 9) e abertura em ecrã inteiro.
- **CMS:** ao editar uma notícia ou um projecto, o cartão já não fecha quando se acrescenta uma fotografia, um documento ou outro elemento. **[C]**

### 2.12.0 · 24 Out 2026
- **Menus com submenu e página própria:** um item com submenu pode também abrir a sua página geral (por exemplo, Responsabilidade Social). **[S, C]**
  - **No site:** clicar no texto abre a página e a seta abre o submenu. No computador, passar o rato continua a mostrar o submenu. No telemóvel, o texto abre a página e a seta (área de toque maior) abre o submenu.
  - **No CMS:** no campo "Destino" de um item com submenu, escolha a página geral, ou "— Sem página própria (só abre o submenu) —" para manter o comportamento anterior.

### 2.11.0 · 24 Out 2026 · Segurança (auditoria AppSec, OWASP Top 10)

- **Bibliotecas próprias:** as bibliotecas passam a ser servidas pelo próprio site (`vendor/`). A dependência do CDN cdnjs deixa de existir (three.js r128 e PDF.js 3.11.174). **[S, repo]**
- **Código externo:** o código JavaScript passa para ficheiros externos (`assets/store.js`, `assets/site.js`, `assets/admin.js`). Isto permite uma CSP sem `'unsafe-inline'` nos scripts. **[S, C, repo]**
- **Cabeçalhos de segurança:** novos cabeçalhos no `vercel.json`. **[V]**
  - Content-Security-Policy, Permissions-Policy e Cross-Origin-Opener-Policy.
  - Cache longa para `vendor/`.
- **Links e endereços:** os endereços editáveis passam a ser validados. `javascript:`, `vbscript:` e `data:` em links passam a `#`. Os endereços em `url()` de CSS também são escapados. **[S]**
- **Textos do site:** escapados em todas as mensagens dos formulários. **[S]**
- **Links externos:** passam a ter `rel="noopener noreferrer"`. **[S, editor]**
- **Leitor de PDF no modo local:** o iframe de recurso passa a ter `sandbox` e `referrerpolicy="no-referrer"`. **[S]**
- **Formulários:**
  - campo-isco anti-robô;
  - tempo mínimo de preenchimento;
  - `maxlength` em todos os campos;
  - limites de tamanho. **[S]**
- **Novo: `supabase/03-seguranca.sql`** **[B]**
  - Gatilho anti-spam: 5 mensagens por IP em 10 minutos e 200 por hora no total.
  - Rejeição do campo-isco e validação do tipo e do tamanho dos campos.
  - O IP é guardado apenas como hash diário com sal.
- **CMS:** **[C]**
  - removido o handler inline `onclick`;
  - removida a palavra-passe por defeito ("cornelder") do modo local; no primeiro acesso é obrigatório definir uma;
  - hash com sal;
  - mínimo de 8 caracteres.

### 2.10.0 · 24 Out 2026
- **Novo:** o número da versão aparece no CMS (rodapé da barra lateral) e no código do site. **[C, S]**
- **Novo:** este histórico de versões (`CHANGELOG.md`). **[repo]**
- **Novo:** o manual de utilização do CMS (`Manual-CMS-Port-of-Beira.docx`). **[documentação]**

### 2.9.0 · 24 Out 2026
- **Novo:** botão **"Sequência aleatória"** na lista de vídeos de cada página. Com o botão ligado, cada visita começa num vídeo diferente e baralha a ordem. **[C]**
- **Novo:** em Topo das páginas → Ordem dos vídeos, os botões "Aleatória em todas as páginas" e "Pela ordem em todas". **[C]**

### 2.8.1 · 24 Out 2026
- **Telemóvel:** os botões EN/PT e a temperatura ficam fixos na barra de topo, ao lado do menu. **[S]**
- **Telemóvel:** o logótipo fica ligeiramente mais pequeno em ecrãs estreitos, para nada se sobrepor. **[S]**
- **Corrigido:** a temperatura não aparecia no telemóvel. Se o serviço de meteorologia falhar, o site tenta de novo ao fim de 1 minuto. **[S]**

### 2.8.0 · 24 Out 2026
- **Novo:** grelha dinâmica de 3 fotografias por baixo do texto das páginas de conteúdo. **[S, C]**
  - Disposição em mosaico (1 grande + 2) ou em três iguais.
  - Zoom ao passar o rato, legenda e abertura em ecrã inteiro.
  - Com mais de 3 fotografias (até 9), a grelha roda suavemente.
- **Novo:** cartão **Grelha de fotografias** em todas as páginas de conteúdo do CMS. **[C]**

### 2.7.0 · 24 Out 2026
- **Novo:** temperatura actual da Beira na barra superior, com ícone do estado do tempo. **[S]**
  - Os dados vêm do Open-Meteo e actualizam a cada 30 minutos.
- **Novo:** em Menus e redes → **Temperatura na barra superior**: ligar ou desligar, cidade, latitude e longitude. **[C]**

### 2.6.0 · 24 Out 2026
- **Padrão único de cartões** (4 por linha, imagem 16:11, título, breve introdução, "Saiba mais"). Aplica-se a: **[S]**
  - notícias em destaque;
  - terminais da página inicial;
  - cartões das páginas;
  - listas de Notícias e Projectos;
  - Publicações.
- **Responsivo:** 3 por linha em ecrãs médios, 2 em tablet e 1 no telemóvel. **[S]**

### 2.5.0 · 24 Out 2026
- **Notícias em destaque:** até 5 notícias na página inicial (antes eram 3). **[S, C]**
- **Conteúdo já publicado:** passa sozinho para 5 na primeira entrada no CMS. **[C]**

### 2.4.1 · 24 Out 2026
- **CMS:** a barra de topo fica fixa ao fazer scroll. **[C]**
- **CMS:** no telemóvel, o logótipo e os botões da barra de topo já não se sobrepõem. **[C]**

### 2.4.0 · 24 Out 2026
- **Novo:** os cartões das páginas passam a ter imagem, breve introdução e "Saiba mais". **[S, C]**
  - Cada cartão pode levar a uma página do site ou a um endereço (URL), com a opção de abrir num novo separador.
  - Aparecem em linhas de 4, em toda a largura, por baixo do texto.

### 2.3.0 · 24 Out 2026
- **Distâncias:** a tabela "Ver todas as distâncias" passa a uma matriz em toda a largura. **[S]**
  - Tem barras, um ✓ no porto mais perto e a coluna "Vantagem Beira".
  - No telemóvel aparece em cartões.
  - Clicar numa linha escolhe esse destino no mapa.
- **Novo:** fundo da secção de distâncias com cor e opacidade reguláveis. Com fundo claro, os textos passam a escuros automaticamente. **[S, C]**
- **Novo:** menus com vários níveis (menu → submenu → submenu do submenu, até 4 níveis). **[S, C]**
  - No computador, os níveis seguintes abrem ao lado; no telemóvel, em lista.
- **Tipografia:** títulos, números, botões, menus e etiquetas passam a peso médio (500), com menos negrito. **[S]**
  - O conteúdo já publicado é acertado na primeira entrada no CMS. **[C]**

### 2.2.0 · 24 Out 2026
- **Vídeos por página:**
  - cada página tem um código próprio (hero, tc, tcg, asso, csr…);
  - o botão **Detectar vídeos** procura na pasta `videos/` os ficheiros com esse código. **[C]**
- **CMS:** a página de entrada passa a usar Dax regular. **[C]**
- **Menus:** botão **"+ Link com URL"** em todos os menus, com a opção "Abrir num novo separador". **[S, C]**
- **Vídeo no telemóvel:** o vídeo aparece completo, em 16:9, com o texto por baixo. Há também a opção "Ecrã inteiro" com ponto de foco. **[S, C]**
- **Corrigido:** no telemóvel, o menu não abria depois de descer na página. **[S]**
- **Espaçamento das letras:** passou a haver um padrão único para web e telemóvel, regulável em Tipografia. **[S, C]**
- **Distâncias e localização:** refeito como um só bloco. **[S]**
  - Mapa real da África Austral, com rotas pelas estradas principais.
  - Comparação com os outros portos e mensagem de vantagem.
  - A localização passa a uma linha compacta.
- **Novo:** bloco de notícias em destaque antes do rodapé, com a opção "Destaque na página inicial" em cada notícia. **[S, C]**
- **Links úteis:** o Plano de Atracação foi acrescentado. **[S, C]**

### 2.1.0 · 23 Out 2026
- **Tarifas e Procedimentos:** passa a ter secções de documentos. **[S, C]**
  - Secções de origem: ROC, Tariff Book e Circulars.
  - Cada secção é bilingue, editável, e é possível acrescentar mais.
  - Os documentos aparecem numa grelha de 4 por linha, ordenados pela data de publicação.

### 2.0.4 · 23 Out 2026
- **Vídeo do topo:**
  - toca mesmo com "Reduzir movimento" ligado;
  - um vídeo em falta é saltado. **[S]**
- **Cache:** a cache de vídeos e imagens passa de 30 dias para 1 dia. **[V]**
- **Ficheiros de vídeo:** preparados para começar a tocar enquanto descarregam (faststart) e sem som. **[M]**

### 2.0.3 · 23 Out 2026
- **Novo:** diagnóstico de vídeo, abrindo o site com `?diag=1`. **[S]**
- **Novo:** botão ▶ visível quando o telemóvel bloqueia o arranque automático. **[S]**

### 2.0.2 · 23 Out 2026
- **`config.js`:** preenchido com o projecto Supabase. **[config]**
- **Endereço do Supabase:** passa a aceitar o URL com `/rest/v1/` no fim. **[S, C]**

### 2.0.1 · 23 Out 2026
- **Vídeo no telemóvel:** ligado por defeito. **[S, C]**
- **Arranque bloqueado:** quando o telemóvel bloqueia o arranque automático, aparece a imagem de capa e o vídeo começa ao primeiro toque. **[S]**

### 2.0.0 · 22 Out 2026
- **Nova arquitectura:** Supabase (base de dados, ficheiros e login) e Vercel (alojamento). **[S, C, B, V]**
  - O conteúdo publicado é partilhado com todos os visitantes.
  - Imagens, vídeos, PDFs e fontes ficam no Supabase Storage.
  - O formulário de contacto e as denúncias ficam guardados, e só os editores os lêem.
  - Cada editor entra com o seu email e palavra-passe, com recuperação por email.
  - A lista de editores gere-se no CMS.
  - O histórico guarda as últimas 50 publicações, com possibilidade de reposição.
- **Importação da versão 1:** o JSON da versão 1 pode ser importado, e as imagens e vídeos embutidos são enviados automaticamente para o Storage. **[C]**
- **Modo local:** sem `config.js` preenchido, o site funciona como a versão 1. **[S, C]**
- **Ficheiros novos:** `config.js`, `vercel.json`, `supabase/01-estrutura.sql`, `supabase/02-primeiro-editor.sql` e `LEIA-ME.md`.

---

## Versão 1: ficheiros HTML com conteúdo no navegador / artefacto Claude

> As datas da versão 1 são aproximadas (21–22 Out 2026).

### 1.14.0
- **Editor de texto:** carregamento de imagens dentro dos artigos, com legenda e alinhamento.

### 1.13.0
- **Título do topo da página inicial:** totalmente editável, com cor por palavra, quebras de linha e tamanho.
- **Corrigido:** a cor dos ícones (laranja) em todas as páginas.

### 1.12.1
- **Topo das páginas:** os textos do topo de cada página passam a ser editáveis.

### 1.12.0
- **Editor de texto profissional:** para textos longos.
- **Textos:** todos os textos das páginas passam a ser editáveis.
- **CMS bilingue:** em PT e EN.
- **Ícones e números:** com o mesmo desenho.
- **Títulos:** menu de cores (azul e laranja Cornelder, cinzento claro, branco e preto) e imagem no título, com definições de desempenho.
- **Topo:** lista de até 5 vídeos em loop, fácil de configurar.
- **Redes sociais:** ícones de cada rede.

### 1.11.1
- **Posição do Porto:** acesso directo na barra lateral do CMS.

### 1.11.0
- **PDFs:** carregamento e leitura de PDFs dentro da página.
  - Plano de Atracação: 2 documentos (Terminal de Contentores e Terminal de Carga Geral).
  - Posição do Porto: 1 documento.

### 1.10.1
- **Corrigido:** o erro "Sem espaço no navegador". O armazenamento passou para IndexedDB e foi acrescentado um medidor de espaço.

### 1.10.0
- **Menu:** faixa azul por trás do menu, com degradê regulável.

### 1.9.0
- **Tipografia:** escolha do tipo e do tamanho de letra para todos os títulos e textos.

### 1.8.0
- **Vídeo:** degradê regulável sobre o vídeo do topo.

### 1.7.0
- **Largura:** conteúdo alargado, com 8 cm de margem nas laterais.

### 1.6.0
- **Texto do topo:** numa caixa mais estreita e mais clara, com texto justificado e peso de letra ajustável.

### 1.5.0
- **Vídeo no topo:** suporte para vários vídeos no topo e vídeo por página.

### 1.4.0
- **Logótipos:** oficiais, nas versões azul e branca.

### 1.3.0
- **Entrega:** em ficheiros `.html` independentes.

### 1.2.0
- **Menus:** todos os menus e submenus do site original.
- **Contactos.**
- **Site bilingue:** EN/PT.

### 1.1.0
- **CMS:** separado do site (`admin.html`).
- **Corrigido:** o valor "400,00 TEU's" foi reposto exactamente como no original.

### 1.0.0
- **Primeira versão:** a partir do conteúdo de cornelder.co.mz.
  - Design moderno com cena 3D, compatível com telemóvel, logótipo Cornelder e letra Dax.
  - CMS para actualizar o conteúdo.
