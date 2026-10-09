/**
 * The translate proof's memo (`@/lib/probes/ai-proof-content`) rendered by
 * hand in every language the translate check counts marker words of — the
 * corpus `ai-proof-content.test.ts` holds those markers to, and the wrong
 * packages it builds.
 *
 * WHY THEY EXIST (2026-10-09). The check counted "Spanish" in words Spanish
 * shares with its neighbours, and the only wrong language its test tried was
 * English. A reviewer rendered the memo in Italian, Portuguese, Catalan and
 * French, packaged each as Spanish, and all four passed as "a Spanish
 * translation". Renderings like those are kept here so every marker has a
 * text it must be found in and texts it must not be found in.
 *
 * Every translation is the title and the memo's sentences, one per line, in
 * the memo's order, names kept as a translator keeps them; the test holds the
 * line count. There are three Spanish renderings in different words —
 * Spain's, Latin America's and Mexico's — and the first again with the
 * bridge's name translated and left in English, so the check is shown to pass
 * correct translations it was not written against.
 *
 * The wrong packages built from them (re-review, 2026-10-09): the Spanish with
 * one line left in English, at every position; the Spanish whose last lines
 * drifted into each neighbour; and the Spanish cut short. With other
 * languages' markers allowed up to a quarter of the Spanish ones, one English
 * sentence passed at 6 of 13 positions, and the last 2 to 4 lines in
 * Portuguese or Catalan, or the last 2 in Italian, passed.
 */
import {
  PROOF_MEMO_BODY_NAMES,
  PROOF_MEMO_SENTENCES,
  PROOF_MEMO_TITLE,
  mentions,
  type MarkedLanguage,
} from "@/lib/probes/ai-proof-content";

/** The memo as drawn: its title, then its sentences. */
export const MEMO_TEXT = [PROOF_MEMO_TITLE, ...PROOF_MEMO_SENTENCES].join("\n");

/** The memo re-told in its OWN language: names kept, nothing verbatim. */
export const ENGLISH_PARAPHRASE =
  "Memo on the Kestrel Bridge: the crossing over the Varrow River was checked by " +
  "Ingrid Halvorsen, who saw that four of its cables are corroded. They are to be " +
  "replaced over nine weeks for 2.48 million euros, and trucks must use a ferry " +
  "while the work is under way.";

export const SPANISH_TRANSLATION = [
  "Memorando de inspección del puente Kestrel",
  "El puente Kestrel lleva la carretera de la costa sobre el río Varrow.",
  "La ingeniera Ingrid Halvorsen inspeccionó el puente el 14 de marzo.",
  "Encontró corrosión en cuatro de los doce cables de acero que sostienen el tramo principal.",
  "Dos de esos cables han perdido más de una décima parte de su resistencia.",
  "La reparación sustituirá los cuatro cables y durará nueve semanas.",
  "Se espera que cueste 2.480.000 euros, pagados con el fondo regional de carreteras.",
  "Los camiones de más de siete toneladas no podrán cruzar el puente mientras duren las obras.",
  "Los coches y las bicicletas aún podrán cruzar, pero solo por un carril a la vez.",
  "Un transbordador desde el puerto de Ostby llevará los camiones al otro lado del río.",
  "El ayuntamiento debe aprobar el presupuesto antes de finales de abril.",
  "Si las obras se retrasan más allá de junio, el puente se cerrará a todo el tráfico.",
  "Halvorsen también recomienda sustituir los otros ocho cables en un plazo de cinco años.",
  "La próxima inspección completa del puente Kestrel está prevista dentro de dos años.",
].join("\n");

/**
 * Another translator, other words: Latin American usage, other verbs — and
 * the Spanish words the check must NOT count as another language's ("le",
 * "les", "une", "va", "es", "o", "dos"), so a marker set that took one in
 * fails the test rather than a correct translation.
 */
export const SPANISH_TRANSLATION_SECOND = [
  "Memorándum sobre la inspección del puente Kestrel",
  "El puente Kestrel, que une las dos orillas del río Varrow, sostiene la carretera costera.",
  "La ingeniera Ingrid Halvorsen le hizo una revisión al puente el 14 de marzo.",
  "Halló corrosión en cuatro de sus doce cables de acero, los que sostienen el vano principal.",
  "Dos de esos cables perdieron más de la décima parte de su resistencia.",
  "La reparación va a reemplazar los cuatro cables y tomará nueve semanas.",
  "El costo es de unos 2.480.000 euros, que saldrán del fondo regional de caminos.",
  "A los camiones de más de siete toneladas no se les permitirá pasar por el puente hasta que terminen las obras.",
  "Autos y bicicletas sí podrán pasar, pero por un solo carril a la vez.",
  "Un ferry desde el puerto de Ostby llevará los camiones a la otra orilla.",
  "El concejo municipal tiene que aprobar el presupuesto antes de fines de abril.",
  "Si las obras se demoran más allá de junio, el puente se cerrará al tránsito por completo.",
  "Halvorsen recomienda además reemplazar los otros ocho cables en cinco años o menos.",
  "La siguiente inspección completa del puente Kestrel será en dos años.",
].join("\n");

/**
 * A third translator, Mexican usage: "carros", "cabildo", "nada más", "se van
 * a cambiar", a comma as the thousands separator. Written after the check, so
 * it is a correct translation the check was not tuned to.
 */
export const SPANISH_TRANSLATION_MEXICAN = [
  "Memorándum de la inspección al puente Kestrel",
  "El puente Kestrel lleva la carretera costera por encima del río Varrow.",
  "La ingeniera Ingrid Halvorsen revisó el puente el 14 de marzo.",
  "Detectó corrosión en cuatro de los doce cables de acero que cargan el claro principal.",
  "Dos de esos cables ya perdieron más de una décima parte de su resistencia.",
  "Con la reparación se van a cambiar los cuatro cables, y los trabajos durarán nueve semanas.",
  "Se calcula que costará 2,480,000 euros, que se van a pagar del fondo regional de carreteras.",
  "Los camiones de más de siete toneladas no podrán cruzar el puente mientras duren los trabajos.",
  "Los carros y las bicicletas sí van a poder pasar, pero nada más por un carril a la vez.",
  "Un ferry que sale del puerto de Ostby va a llevar los camiones al otro lado del río.",
  "El cabildo tiene que aprobar el presupuesto antes de que termine abril.",
  "Si los trabajos se atrasan más allá de junio, el puente se va a cerrar a todo el tránsito.",
  "Halvorsen también recomienda cambiar los otros ocho cables en un plazo de cinco años.",
  "La próxima inspección completa del puente Kestrel toca dentro de dos años.",
].join("\n");

/** The first rendering with the bridge's name translated, as a translator may render a bird's name. */
export const SPANISH_TRANSLATION_CERNICALO = SPANISH_TRANSLATION.replaceAll(
  "puente Kestrel",
  "puente Cernícalo",
);

/** The first rendering with the bridge's name kept in English, as a proper name. */
export const SPANISH_TRANSLATION_KESTREL_BRIDGE =
  SPANISH_TRANSLATION.replaceAll("puente Kestrel", "Kestrel Bridge");

export const ITALIAN_TRANSLATION = [
  "Promemoria sull'ispezione del ponte Kestrel",
  "Il ponte Kestrel porta la strada costiera sopra il fiume Varrow.",
  "L'ingegnera Ingrid Halvorsen ha ispezionato il ponte il 14 marzo.",
  "Ha trovato corrosione su quattro dei dodici cavi d'acciaio che sostengono la campata principale.",
  "Due di quei cavi hanno perso più di un decimo della loro resistenza.",
  "La riparazione sostituirà tutti e quattro i cavi e durerà nove settimane.",
  "Si prevede che costi 2.480.000 euro, pagati con il fondo regionale per le strade.",
  "I camion oltre le sette tonnellate non potranno attraversare il ponte durante i lavori.",
  "Auto e biciclette potranno ancora passare, ma solo su una corsia alla volta.",
  "Un traghetto dal porto di Ostby trasporterà invece i camion sull'altra sponda del fiume.",
  "Il consiglio comunale deve approvare il bilancio entro la fine di aprile.",
  "Se i lavori slittano oltre giugno, il ponte sarà chiuso a tutto il traffico.",
  "Halvorsen raccomanda anche di sostituire gli altri otto cavi entro cinque anni.",
  "La prossima ispezione completa del ponte Kestrel è prevista tra due anni.",
].join("\n");

export const PORTUGUESE_TRANSLATION = [
  "Memorando de inspeção da ponte Kestrel",
  "A ponte Kestrel leva a estrada costeira sobre o rio Varrow.",
  "A engenheira Ingrid Halvorsen inspecionou a ponte em 14 de março.",
  "Ela encontrou corrosão em quatro dos doze cabos de aço que sustentam o vão principal.",
  "Dois desses cabos perderam mais de um décimo da sua resistência.",
  "A reparação vai substituir os quatro cabos e vai durar nove semanas.",
  "Deverá custar 2.480.000 euros, pagos pelo fundo regional de estradas.",
  "Os camiões com mais de sete toneladas não podem atravessar a ponte enquanto durarem as obras.",
  "Os carros e as bicicletas ainda podem passar, mas apenas por uma faixa de cada vez.",
  "Um ferry do porto de Ostby vai levar os camiões para o outro lado do rio.",
  "A câmara municipal tem de aprovar o orçamento antes do fim de abril.",
  "Se as obras atrasarem para além de junho, a ponte será fechada a todo o trânsito.",
  "Halvorsen também recomenda substituir os outros oito cabos no prazo de cinco anos.",
  "A próxima inspeção completa da ponte Kestrel está prevista para daqui a dois anos.",
].join("\n");

export const CATALAN_TRANSLATION = [
  "Memoràndum d'inspecció del pont Kestrel",
  "El pont Kestrel porta la carretera de la costa per sobre del riu Varrow.",
  "L'enginyera Ingrid Halvorsen va inspeccionar el pont el 14 de març.",
  "Va trobar corrosió en quatre dels dotze cables d'acer que sostenen el tram principal.",
  "Dos d'aquests cables han perdut més d'una desena part de la seva resistència.",
  "La reparació substituirà els quatre cables i durarà nou setmanes.",
  "Es preveu que costi 2.480.000 euros, pagats amb el fons regional de carreteres.",
  "Els camions de més de set tones no podran creuar el pont mentre durin les obres.",
  "Els cotxes i les bicicletes encara podran passar, però només per un carril alhora.",
  "Un transbordador des del port d'Ostby portarà els camions a l'altra banda del riu.",
  "L'ajuntament ha d'aprovar el pressupost abans de finals d'abril.",
  "Si les obres s'endarrereixen més enllà de juny, el pont es tancarà a tot el trànsit.",
  "Halvorsen també recomana substituir els altres vuit cables en un termini de cinc anys.",
  "La propera inspecció completa del pont Kestrel està prevista d'aquí a dos anys.",
].join("\n");

export const FRENCH_TRANSLATION = [
  "Note d'inspection du pont Kestrel",
  "Le pont Kestrel porte la route côtière au-dessus de la rivière Varrow.",
  "L'ingénieure Ingrid Halvorsen a inspecté le pont le 14 mars.",
  "Elle a constaté de la corrosion sur quatre des douze câbles d'acier qui soutiennent la travée principale.",
  "Deux de ces câbles ont perdu plus d'un dixième de leur résistance.",
  "La réparation remplacera les quatre câbles et durera neuf semaines.",
  "Elle devrait coûter 2 480 000 euros, payés par le fonds régional des routes.",
  "Les camions de plus de sept tonnes ne pourront pas traverser le pont pendant les travaux.",
  "Les voitures et les vélos pourront toujours passer, mais sur une seule voie à la fois.",
  "Un bac depuis le port d'Ostby transportera les camions de l'autre côté de la rivière.",
  "Le conseil municipal doit approuver le budget avant la fin avril.",
  "Si les travaux sont retardés au-delà de juin, le pont sera fermé à toute circulation.",
  "Halvorsen recommande aussi de remplacer les huit autres câbles d'ici cinq ans.",
  "La prochaine inspection complète du pont Kestrel est prévue dans deux ans.",
].join("\n");

/** Every rendering, by the language it is in. */
export const MEMO_RENDERINGS: Readonly<
  Record<MarkedLanguage, readonly string[]>
> = {
  spanish: [
    SPANISH_TRANSLATION,
    SPANISH_TRANSLATION_SECOND,
    SPANISH_TRANSLATION_MEXICAN,
    SPANISH_TRANSLATION_CERNICALO,
    SPANISH_TRANSLATION_KESTREL_BRIDGE,
  ],
  english: [MEMO_TEXT, ENGLISH_PARAPHRASE],
  italian: [ITALIAN_TRANSLATION],
  portuguese: [PORTUGUESE_TRANSLATION],
  french: [FRENCH_TRANSLATION],
  catalan: [CATALAN_TRANSLATION],
};

/** Spanish's neighbours, by the language each rendering is in. */
export const NEIGHBOUR_RENDERINGS = {
  italian: ITALIAN_TRANSLATION,
  portuguese: PORTUGUESE_TRANSLATION,
  catalan: CATALAN_TRANSLATION,
  french: FRENCH_TRANSLATION,
} as const;

/**
 * {@link SPANISH_TRANSLATION} with its line `line` — 0 the title, then one
 * per sentence — left in the memo's English: a model that skipped one.
 */
export function spanishWithEnglishLine(line: number): string {
  const english = MEMO_TEXT.split("\n");
  return SPANISH_TRANSLATION.split("\n")
    .map((spanish, i) => (i === line ? english[i]! : spanish))
    .join("\n");
}

/**
 * {@link SPANISH_TRANSLATION} whose last `count` lines are `rendering`'s: a
 * model that drifted into another language for the end of the memo.
 */
export function spanishDriftingInto(rendering: string, count: number): string {
  const spanish = SPANISH_TRANSLATION.split("\n");
  const other = rendering.split("\n");
  return [
    ...spanish.slice(0, spanish.length - count),
    ...other.slice(other.length - count),
  ].join("\n");
}

/**
 * A translation that drifts: Spanish for its first nine lines, Italian for
 * the rest — a model that changed language partway. Enough Spanish to clear
 * the Spanish minimum on its own, so only the count of the OTHER languages'
 * markers can refuse it.
 */
export const SPANISH_DRIFTING_INTO_ITALIAN = spanishDriftingInto(
  ITALIAN_TRANSLATION,
  5,
);

/**
 * {@link SPANISH_TRANSLATION} cut short: every line before the first that
 * carries the LAST of the memo's body names to appear — a translation that
 * stopped partway, Spanish and of the memo, missing a name the memo goes on
 * to give.
 */
export const SPANISH_TRANSLATION_CUT_SHORT = (() => {
  const lines = SPANISH_TRANSLATION.split("\n");
  const cut = Math.max(
    ...PROOF_MEMO_BODY_NAMES.map((name) =>
      lines.findIndex((line) => mentions(line, name)),
    ),
  );
  return lines.slice(0, cut).join("\n");
})();
