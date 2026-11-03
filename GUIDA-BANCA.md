# Collegare Tasca a BancoPosta

Tasca scarica saldo e movimenti tramite **Enable Banking**, un intermediario autorizzato
(PSD2). Serve anche un piccolo **server personale** gratuito su Supabase, che custodisce la
chiave di Enable Banking: la chiave non deve mai stare sul telefono.

Tempo stimato: 20–30 minuti, una volta sola.

> **Prima di iniziare:** Tasca deve essere già pubblicata online, con un indirizzo che
> inizia con `https://` (es. `https://chrimitra.github.io/pocket/`). La banca, dopo che hai
> autorizzato l'accesso, rimanda a quell'indirizzo. Lo trovi anche in fondo alla pagina
> **Impostazioni → Collegamento banca** dell'app pubblicata.

I nomi di menu e pulsanti di Enable Banking e Supabase possono cambiare leggermente nel
tempo: se qualcosa non corrisponde, cerca la voce più simile.

---

## 1. Enable Banking: crea l'applicazione

1. Vai su **enablebanking.com**, registrati e apri il **Control Panel**.
2. Nella sezione **Applications** crea una nuova applicazione:
   - **Environment:** `Production`
   - **Name:** `Tasca` (o quello che vuoi)
   - **Allowed redirect URLs:** l'indirizzo della tua app, es. `https://chrimitra.github.io/pocket/`
     (deve essere identico, compresa la `/` finale)
   - Gli altri campi obbligatori (descrizione, email, privacy) compilali con i tuoi dati:
     l'app è solo per uso personale.
   - Per la chiave scegli di **generarla nel browser**: verrà scaricato un file `.pem`.
     **Conservalo con cura e non condividerlo**: chi ha questo file può leggere i tuoi movimenti.
3. Annota l'**Application ID** (è anche il nome del file `.pem`, senza estensione).
4. L'applicazione nasce "Inactive". Tocca **Activate by linking accounts**, scegli
   **Poste Italiane / BancoPosta** e accedi con le tue credenziali e PosteID.
   Da quel momento l'app è attiva in **modalità ristretta**: può leggere solo i conti che
   hai collegato tu. È la modalità prevista per l'uso personale non commerciale.

## 2. Supabase: crea il server

1. Vai su **supabase.com**, registrati e crea un **nuovo progetto** (piano gratuito).
   Regione consigliata: una europea, es. Frankfurt.
2. Apri **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Chiama la funzione **`banca`**.
4. Cancella il codice di esempio e incolla tutto il contenuto del file
   `server/supabase/functions/banca/index.ts` di questo progetto. Poi **Deploy**.
5. Nelle impostazioni della funzione **disattiva "Verify JWT"** (o "Enforce JWT verification"):
   la protezione la fa la chiave `TASCA_TOKEN` del passo successivo.
6. Apri **Edge Functions → Secrets** (o Project Settings → Edge Functions) e aggiungi:

   | Nome | Valore |
   |---|---|
   | `EB_APP_ID` | l'Application ID del passo 1.3 |
   | `EB_PRIVATE_KEY` | tutto il contenuto del file `.pem`, comprese le righe `-----BEGIN…` e `-----END…` |
   | `TASCA_TOKEN` | una password lunga inventata da te (es. 5 parole a caso) |
   | `ALLOWED_ORIGIN` | l'indirizzo dell'app **senza percorso**, es. `https://chrimitra.github.io` |

7. Copia l'indirizzo della funzione. Ha questa forma:
   `https://<codice-progetto>.supabase.co/functions/v1/banca`

## 3. Tasca: collega la banca

1. Apri Tasca (quella pubblicata online, meglio se già installata sulla schermata Home).
2. **Ingranaggio in Home → Collegamento banca → Configura il server.**
3. Incolla l'indirizzo della funzione e la password `TASCA_TOKEN`, poi **Salva e prova**.
   Se compare "Server collegato ✓", il server funziona e la chiave è stata letta correttamente.
4. Tocca **Collega BancoPosta**, scegli il conto di Tasca da abbinare e **Continua su Poste**.
5. Accedi su Poste e conferma con **PosteID**. Tornerai in Tasca e i movimenti degli ultimi
   90 giorni verranno scaricati. Il saldo di Tasca viene allineato a quello della banca.

## Come funziona dopo

- **Aggiornamento automatico:** quando apri l'app, se sono passate almeno 6 ore dall'ultimo
  aggiornamento. Puoi sempre forzarlo con **Aggiorna ora**.
- **Movimenti già inseriti a mano** (o importati da file) vengono riconosciuti e abbinati,
  non duplicati: tengono la categoria che avevi scelto tu.
- **Categorie:** le regole automatiche categorizzano i nuovi movimenti. Quelli senza regola
  compaiono come **"da rivedere"**: scegli la categoria e, se vuoi, Tasca crea la regola
  per le volte successive.
- **Rinnovo:** il consenso dura al massimo 180 giorni (dipende dalla banca). Due settimane
  prima della scadenza la Home te lo ricorda: tocca **Rinnova** e conferma con PosteID.
- **Solo lettura:** né Tasca né il server possono fare pagamenti.

## Se qualcosa non va

| Messaggio | Cosa fare |
|---|---|
| "Chiave di accesso errata" | La password in Tasca è diversa da `TASCA_TOKEN` su Supabase. |
| "Sul server mancano EB_APP_ID o EB_PRIVATE_KEY" | Controlla i Secrets su Supabase e rifai il deploy. |
| "L'indirizzo dell'app non è tra quelli permessi" | `ALLOWED_ORIGIN` deve essere l'inizio dell'indirizzo dell'app, es. `https://chrimitra.github.io`. |
| Errore sul redirect da Enable Banking | L'indirizzo in "Allowed redirect URLs" deve essere identico a quello mostrato in Tasca. |
| "Il server non risponde" | Indirizzo della funzione sbagliato, oppure "Verify JWT" ancora attivo. |
