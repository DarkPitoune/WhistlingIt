import type { Category, Difficulty } from "../api/types";
import type { Lang } from "./lang";

/**
 * Every word the app says, twice.
 *
 * ── why one big interface rather than a bag of keys ─────────────────────────
 * `Strings` is a type, so a missing French line is a compile error rather than a
 * blank on screen or an English sentence in the middle of a French page. There
 * is no lookup by string key anywhere, no fallback chain and no `t("some.key")`
 * that silently returns its own key — the two objects below are checked against
 * the same shape and that is the whole safety net.
 *
 * ── why the interpolations are functions ────────────────────────────────────
 * `"%s of %d players"` cannot be translated. Word order moves, plurals do not
 * agree the same way, and French puts a space before its own colon. A function
 * takes the numbers and returns the finished sentence, so each language composes
 * its own — see `solveRate`, where English needs "has"/"have" and French needs
 * "a"/"ont" at a different threshold of the same sentence.
 *
 * ── what is deliberately NOT in here ───────────────────────────────────────
 * `Category` and `Difficulty` values stay English everywhere they are stored or
 * sent: they are enum values validated by the API, and translating the wire
 * format would mean a French booth uploading a category the server rejects.
 * Only their *labels* live here, keyed by the English value.
 */
export interface Strings {
  /**
   * The <title>, and the text a share unfurls as.
   *
   * Read twice: once at runtime by I18nProvider, and once at build time by
   * scripts/lang-roots.mjs, which bakes it into the static /fr and /en
   * documents. An unfurler does not run the bundle, so the static copy is the
   * only one a pasted link ever shows — that is why this lives here rather than
   * in index.html.
   */
  htmlTitle: string;
  /** The meta description, same two readers as `htmlTitle`. */
  htmlDescription: string;
  /** The sr-only h1. The only heading on the page. */
  pageHeading: string;

  nav: {
    backToDaily: string;
    addYourWhistle: string;
    otherDays: string;
    seeOtherDays: string;
    backToCalendar: string;
    tryAgain: string;
    streakTitle: (days: number) => string;
  };

  load: {
    /** aria-label on the spinner. */
    loading: string;
    fetchingToday: string;
    fetchingThatDay: string;
    noWhistleToday: string;
    noWhistleThatDay: string;
    unreachable: string;
    nothingThatDay: string;
    noWhistleSetFor: (date: string) => string;
  };

  daily: {
    notesUnlocked: string;
    play: string;
    pause: string;
    seekBack: (seconds: number) => string;
    seekForward: (seconds: number) => string;
    /** The scrub bar, which is a slider to a screen reader and nothing to anyone else. */
    barLabel: string;
    barValueText: (heard: string, open: string) => string;
    difficulty: (label: string) => string;
    beTheFirst: string;
    guessPlaceholder: string;
    guessLabel: string;
    guessSubmit: string;
    wrongGuessesLabel: string;
    giveUp: string;
    skipToAll: (total: number) => string;
    skipTo: (notes: number, total: number) => string;
    replaying: string;
  };

  reveal: {
    solved: string;
    outOfNotes: string;
    recovered: string;
    gotItOn: string;
    missedIt: string;
    noteOf: (note: number, total: number) => string;
    mostGotItOn: (notes: number) => string;
    hearWholeTune: string;
    playingWholeTune: string;
    playItAgain: string;
    copyResult: string;
    copied: string;
    nextWhistleIn: string;
    /**
     * The button that crosses to the other game, named from where you are
     * standing: the English reveal offers "French version".
     *
     * Each dictionary always names the *other* side, so there is no argument —
     * and it is worded in the language of the page rather than its own, because
     * the flag beside it is already doing the recognise-me job that a
     * self-named "Français" would have been there for.
     */
    crossPromoCta: string;
  };

  booth: {
    heading: string;
    tapToWhistle: string;
    takeRecorded: string;
    lengthHint: string;
    seconds: (n: string) => string;
    tapToStop: (elapsed: string) => string;
    startRecording: string;
    stopRecording: string;
    hearYourTake: string;
    playingYourTake: string;
    uploadFileInstead: string;
    recordAnother: string;
    noMicrophone: string;
    unreadableAudio: string;
    title: string;
    from: string;
    fromPlaceholder: string;
    category: string;
    acceptedAnswers: string;
    aliasPlaceholder: string;
    aliasHint: string;
    removeAlias: (alias: string) => string;
    signature: string;
    signaturePlaceholder: string;
    send: string;
    sentKicker: string;
    sentBody: string;
    whistleAnother: string;
  };

  calendar: {
    months: readonly string[];
    /** Seven single letters, Monday first. */
    weekdays: readonly string[];
    prevMonth: string;
    nextMonth: string;
    /** aria-label for a square: "3 September — solved". */
    dayLabel: (day: number, month: string, state: string) => string;
    stateSolved: string;
    stateMissed: string;
    stateNotYet: string;
    stateLoading: string;
    stateNoWhistle: string;
    stateNotPlayed: string;
    legendSolved: string;
    legendMissed: string;
    legendNotPlayed: string;
    legendNoWhistle: string;
    deviceOnly: string;
  };

  theme: {
    toLight: string;
    toDark: string;
    lightTheme: string;
    darkTheme: string;
  };

  toast: {
    dismiss: string;
    uploadProcessed: (title: string) => string;
    uploadFailedWith: (title: string, reason: string) => string;
    uploadFailed: (title: string) => string;
  };

  /** The ingest API's failure taxonomy, as something a whistler can act on. */
  upload: {
    tooBig: string;
    badAudio: string;
    badLabels: string;
    generic: string;
    /**
     * The request never came back — offline, CORS, a dropped connection.
     * Deliberately not phrased as a failure: the take may well have been
     * received and processed, we just never heard the answer.
     */
    lostContact: string;
    boothNotConfigured: string;
    reasons: {
      not_whistle_like: string;
      too_few_notes: string;
      too_many_notes: string;
      too_short: string;
      too_long: string;
      clipping: string;
      not_enough_voiced_audio: string;
      unknown: string;
    };
  };

  /** Empty pool: not an error, just day one on this side. */
  emptyPool: string;

  stats: {
    /** Below ten plays this is the raw ratio; above, a percentage. */
    solveRateFew: (solved: number, plays: number) => string;
    solveRateMany: (percent: number) => string;
    whistlerCredit: (name: string) => string;
    anonymousWhistler: string;
  };

  categories: Record<Category, string>;
  difficulties: Record<Difficulty, string>;
}

const en: Strings = {
  htmlTitle: "WhistlingIt — Whistling It, the daily whistled tune game",
  // The name is written both ways on purpose: people search "whistling it" with
  // a space, and the brand is one word. Both spellings appear here and in the
  // title so the page matches either query.
  htmlDescription:
    "Whistling It is a daily guessing game where every clip is someone whistling the tune. You start with one note — every miss buys you another. A new whistle every day.",
  pageHeading: "WhistlingIt — Whistling It, the daily whistled tune game",

  nav: {
    backToDaily: "Back to the daily",
    addYourWhistle: "Add your whistle!",
    otherDays: "Other days",
    seeOtherDays: "See the other days",
    backToCalendar: "Back to the calendar",
    tryAgain: "Try again",
    streakTitle: (days) => `${days}-day streak`,
  },

  load: {
    loading: "Loading the whistle",
    fetchingToday: "Fetching today's whistle…",
    fetchingThatDay: "Fetching that day's whistle…",
    noWhistleToday: "No whistle today",
    noWhistleThatDay: "No whistle that day",
    unreachable: "Couldn't reach the whistle.",
    nothingThatDay: "Nothing that day",
    noWhistleSetFor: (date) => `No whistle was set for ${date}. Try another square.`,
  },

  daily: {
    notesUnlocked: "notes unlocked",
    play: "Play",
    pause: "Pause",
    seekBack: (s) => `Back ${s} seconds`,
    seekForward: (s) => `Forward ${s} seconds`,
    barLabel: "Position in the whistle",
    barValueText: (heard, open) => `${heard} of ${open} seconds unlocked`,
    difficulty: (label) => `Difficulty: ${label}`,
    beTheFirst: "Be the first to find today's tune!",
    guessPlaceholder: "Name that tune",
    guessLabel: "Your guess",
    guessSubmit: "Guess",
    wrongGuessesLabel: "Wrong guesses so far",
    giveUp: "Give up",
    skipToAll: (total) => `Skip · hear all ${total}`,
    skipTo: (notes, total) => `Skip · hear ${notes}/${total}`,
    replaying: "Replaying",
  },

  reveal: {
    solved: "Solved",
    outOfNotes: "Out of notes",
    recovered:
      "You solved this one before the calendar existed, so the round itself wasn't kept — only that you got it.",
    gotItOn: "got it on",
    missedIt: "missed it",
    noteOf: (note, total) => `note ${note}/${total}`,
    mostGotItOn: (notes) => `most got it on ${notes}`,
    hearWholeTune: "Hear the whole tune",
    playingWholeTune: "Playing the whole tune",
    playItAgain: "Play it again",
    copyResult: "Copy result",
    copied: "Copied ✓",
    nextWhistleIn: "Next whistle in",
    crossPromoCta: "French version",
  },

  booth: {
    heading: "New whistle",
    tapToWhistle: "Tap to whistle",
    takeRecorded: "Take recorded",
    lengthHint: "10–30 seconds is plenty",
    seconds: (n) => `${n} seconds`,
    tapToStop: (elapsed) => `${elapsed}s · tap to stop`,
    startRecording: "Start recording",
    stopRecording: "Stop recording",
    hearYourTake: "Hear your take",
    playingYourTake: "Playing your take",
    uploadFileInstead: "Upload a file instead",
    recordAnother: "Record another audio",
    noMicrophone: "No microphone. You can upload a file instead.",
    unreadableAudio: "Couldn't read that audio. Try a wav, mp3, m4a or ogg file.",
    title: "Title",
    from: "From",
    fromPlaceholder: "Film, artist, whatever places it",
    category: "Category",
    acceptedAnswers: "Accepted answers",
    aliasPlaceholder: "Type one, then press Enter",
    aliasHint:
      "One answer at a time — press Enter or type a comma after each. The title already counts, so add other spellings, languages or nicknames. A guess wins if it matches any one of them.",
    removeAlias: (alias) => `Remove ${alias}`,
    signature: "Sign your whistle!",
    signaturePlaceholder: "Your name — or leave blank to stay anonymous",
    send: "Send to the queue",
    sentKicker: "Sent",
    sentBody:
      "We're processing it now — listening for the notes and checking it's a whistle. You'll get a notice when it's done!",
    whistleAnother: "Whistle another one",
  },

  calendar: {
    months: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
    weekdays: ["M", "T", "W", "T", "F", "S", "S"],
    prevMonth: "Previous month",
    nextMonth: "Next month",
    dayLabel: (day, month, state) => `${day} ${month} — ${state}`,
    stateSolved: "solved",
    stateMissed: "missed",
    stateNotYet: "not yet",
    stateLoading: "loading",
    stateNoWhistle: "no whistle that day",
    stateNotPlayed: "not played",
    legendSolved: "Solved",
    legendMissed: "Missed",
    legendNotPlayed: "Not played",
    legendNoWhistle: "No whistle",
    deviceOnly: "Saved on this device only.",
  },

  theme: {
    toLight: "Switch to the light theme",
    toDark: "Switch to the dark theme",
    lightTheme: "Light theme",
    darkTheme: "Dark theme",
  },

  toast: {
    dismiss: "Dismiss",
    uploadProcessed: (title) => `“${title}” has been processed.`,
    uploadFailedWith: (title, reason) => `“${title}” — ${reason}`,
    uploadFailed: (title) => `“${title}” couldn't be processed.`,
  },

  upload: {
    tooBig: "That recording is too big. Keep it under 10 MB.",
    badAudio: "We couldn't read that recording. Try again.",
    badLabels: "Something in the labels wasn't right.",
    generic: "Upload failed. Your take is still here — try again.",
    lostContact:
      "We lost contact before the booth answered. It may have gone through — check before sending it again.",
    boothNotConfigured: "The booth is not configured (VITE_INGEST_URL).",
    reasons: {
      not_whistle_like: "That doesn't sound like a whistle — humming and recordings don't pass.",
      too_few_notes: "Too short to guess from. Whistle a few more notes.",
      too_many_notes: "That's a long one. Trim it to a recognisable phrase.",
      too_short: "That's too short.",
      too_long: "That's over 40 seconds. Trim it to the tune.",
      clipping: "It's clipping. Move back from the mic and try again.",
      not_enough_voiced_audio: "Mostly silence or noise. Get closer to the mic.",
      unknown: "We couldn't use that take.",
    },
  },

  emptyPool: "Nobody has whistled yet. The booth is open.",

  stats: {
    // Agreement is with the denominator, which is what the noun belongs to:
    // "1 of 1 player has", "1 of 2 players have", "0 of 1 player has".
    solveRateFew: (solved, plays) =>
      `${solved} of ${plays} ${plays === 1 ? "player has" : "players have"} found it`,
    solveRateMany: (percent) => `${percent}% of players found it`,
    whistlerCredit: (name) => `by ${name}`,
    anonymousWhistler: "Anonymous Whistler",
  },

  categories: {
    "Film": "Film",
    "TV Series": "TV Series",
    "Video Games": "Video Games",
    "Jingle": "Jingle",
    "Music": "Music",
  },

  difficulties: {
    "Trivial": "Trivial",
    "A Breeze": "A Breeze",
    "Gust": "Gust",
    "Storm": "Storm",
    "Gasping for Air": "Gasping for Air",
    "Hurricane": "Hurricane",
  },
};

/**
 * The French side.
 *
 * Not a gloss of the English. A few lines are looser on purpose because the
 * literal version reads like a translation: the wind scale keeps the joke rather
 * than the words, and the share/nav copy keeps the register — this is a game, so
 * "Devine la mélodie", not "Saisissez votre réponse".
 *
 * Typography is French typography: a narrow no-break space before `:` and `!`
 * (U+202F, so a line never breaks in front of the punctuation), and « » for
 * quotes in the toasts.
 */
const fr: Strings = {
  htmlTitle: "WhistlingIt — devine la mélodie sifflée du jour",
  // « siffler » et « sifflement » : les deux formes que quelqu'un tape vraiment.
  htmlDescription:
    "WhistlingIt est un jeu quotidien : chaque extrait est quelqu'un qui siffle une mélodie, et il faut la reconnaître. Tu commences avec une seule note, et chaque erreur t'en offre une de plus. Un nouveau sifflement chaque jour.",
  pageHeading: "WhistlingIt — le jeu quotidien où il faut reconnaître une mélodie sifflée",

  nav: {
    backToDaily: "Retour au sifflement du jour",
    addYourWhistle: "Ajoute ton sifflement !",
    otherDays: "Autres jours",
    seeOtherDays: "Voir les autres jours",
    backToCalendar: "Retour au calendrier",
    tryAgain: "Réessayer",
    streakTitle: (days) => `Série de ${days} jour${days > 1 ? "s" : ""}`,
  },

  load: {
    loading: "Chargement du sifflement",
    fetchingToday: "On va chercher le sifflement du jour…",
    fetchingThatDay: "On va chercher le sifflement de ce jour-là…",
    noWhistleToday: "Pas de sifflement aujourd'hui",
    noWhistleThatDay: "Pas de sifflement ce jour-là",
    unreachable: "Impossible de récupérer le sifflement.",
    nothingThatDay: "Rien ce jour-là",
    noWhistleSetFor: (date) => `Aucun sifflement n'a été mis en ligne le ${date}. Essaie une autre case.`,
  },

  daily: {
    notesUnlocked: "notes débloquées",
    play: "Lecture",
    pause: "Pause",
    seekBack: (s) => `Reculer de ${s} secondes`,
    seekForward: (s) => `Avancer de ${s} secondes`,
    barLabel: "Position dans le sifflement",
    barValueText: (heard, open) => `${heard} secondes sur ${open} débloquées`,
    difficulty: (label) => `Difficulté : ${label}`,
    beTheFirst: "Sois le premier à trouver la mélodie du jour !",
    guessPlaceholder: "Devine la mélodie",
    guessLabel: "Ta réponse",
    guessSubmit: "Valider",
    wrongGuessesLabel: "Mauvaises réponses jusqu'ici",
    giveUp: "Abandonner",
    skipToAll: (total) => `Passer · écouter les ${total}`,
    skipTo: (notes, total) => `Passer · écouter ${notes}/${total}`,
    replaying: "Rejoue le",
  },

  reveal: {
    solved: "Trouvé",
    outOfNotes: "Plus de notes",
    recovered:
      "Tu as trouvé celui-là avant que le calendrier existe : la partie elle-même n'a pas été gardée, seulement le fait que tu l'as eue.",
    gotItOn: "trouvé à la",
    missedIt: "raté",
    noteOf: (note, total) => `note ${note}/${total}`,
    mostGotItOn: (notes) => `la plupart ont trouvé à la note ${notes}`,
    hearWholeTune: "Écouter la mélodie en entier",
    playingWholeTune: "Lecture de la mélodie en entier",
    playItAgain: "Rejouer ce jour",
    copyResult: "Copier le résultat",
    copied: "Copié ✓",
    nextWhistleIn: "Prochain sifflement dans",
    crossPromoCta: "Version anglaise",
  },

  booth: {
    heading: "Nouveau sifflement",
    tapToWhistle: "Appuie et siffle",
    takeRecorded: "Prise enregistrée",
    lengthHint: "10 à 30 secondes, c'est largement assez",
    seconds: (n) => `${n} secondes`,
    tapToStop: (elapsed) => `${elapsed}s · appuie pour arrêter`,
    startRecording: "Démarrer l'enregistrement",
    stopRecording: "Arrêter l'enregistrement",
    hearYourTake: "Écouter ta prise",
    playingYourTake: "Lecture de ta prise",
    uploadFileInstead: "Envoyer un fichier à la place",
    recordAnother: "Enregistrer une autre prise",
    noMicrophone: "Pas de micro. Tu peux envoyer un fichier à la place.",
    unreadableAudio: "Impossible de lire cet audio. Essaie un fichier wav, mp3, m4a ou ogg.",
    title: "Titre",
    from: "Artiste",
    fromPlaceholder: "Film, artiste, ce qui le situe",
    category: "Catégorie",
    acceptedAnswers: "Réponses acceptées",
    aliasPlaceholder: "Tape-en une, puis Entrée",
    aliasHint:
      "Une réponse à la fois — appuie sur Entrée ou tape une virgule après chacune. Le titre compte déjà, alors ajoute les autres orthographes, langues ou surnoms. Une réponse gagne si elle correspond à l'une d'entre elles.",
    removeAlias: (alias) => `Retirer ${alias}`,
    signature: "Signe ton sifflement !",
    signaturePlaceholder: "Ton nom — ou laisse vide pour rester anonyme",
    send: "Envoyer dans la file",
    sentKicker: "Envoyé",
    sentBody:
      "On le traite maintenant — on écoute les notes et on vérifie que c'est bien un sifflement. Tu recevras un avis quand ce sera fait !",
    whistleAnother: "En siffler un autre",
  },

  calendar: {
    months: [
      "janvier", "février", "mars", "avril", "mai", "juin",
      "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ],
    // Lundi first, like the grid: L M M J V S D.
    weekdays: ["L", "M", "M", "J", "V", "S", "D"],
    prevMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    dayLabel: (day, month, state) => `${day} ${month} — ${state}`,
    stateSolved: "trouvé",
    stateMissed: "raté",
    stateNotYet: "pas encore",
    stateLoading: "chargement",
    stateNoWhistle: "pas de sifflement ce jour-là",
    stateNotPlayed: "pas joué",
    legendSolved: "Trouvé",
    legendMissed: "Raté",
    legendNotPlayed: "Pas joué",
    legendNoWhistle: "Pas de sifflement",
    deviceOnly: "Enregistré sur cet appareil uniquement.",
  },

  theme: {
    toLight: "Passer au thème clair",
    toDark: "Passer au thème sombre",
    lightTheme: "Thème clair",
    darkTheme: "Thème sombre",
  },

  toast: {
    dismiss: "Fermer",
    uploadProcessed: (title) => `« ${title} » a été traité.`,
    uploadFailedWith: (title, reason) => `« ${title} » — ${reason}`,
    uploadFailed: (title) => `« ${title} » n'a pas pu être traité.`,
  },

  upload: {
    tooBig: "Cet enregistrement est trop lourd. Reste sous 10 Mo.",
    badAudio: "On n'a pas réussi à lire cet enregistrement. Réessaie.",
    badLabels: "Quelque chose n'allait pas dans les informations.",
    generic: "L'envoi a échoué. Ta prise est toujours là — réessaie.",
    lostContact:
      "On a perdu le contact avant la réponse du studio. C'est peut-être passé quand même — vérifie avant de le renvoyer.",
    boothNotConfigured: "Le studio n'est pas configuré (VITE_INGEST_URL).",
    reasons: {
      not_whistle_like: "Ça ne ressemble pas à un sifflement — le fredonnement et les enregistrements ne passent pas.",
      too_few_notes: "Trop court pour être devinable. Siffle quelques notes de plus.",
      too_many_notes: "Celui-là est long. Réduis-le à une phrase reconnaissable.",
      too_short: "C'est trop court.",
      too_long: "Ça dépasse 40 secondes. Réduis-le à la mélodie elle-même.",
      clipping: "Ça sature. Éloigne-toi du micro et réessaie.",
      not_enough_voiced_audio: "Surtout du silence ou du bruit. Rapproche-toi du micro.",
      unknown: "On n'a pas pu utiliser cette prise.",
    },
  },

  emptyPool: "Personne n'a encore sifflé. Le studio est ouvert.",

  stats: {
    // "1 joueur sur 1 l'a trouvé", "1 joueur sur 2 l'ont trouvé" would be wrong:
    // in French the verb agrees with "joueur(s)", the numerator, not with the
    // denominator as in English. So the plural is decided by `solved`, and the
    // noun by the number it is attached to.
    solveRateFew: (solved, plays) =>
      solved <= 1
        ? `${solved} joueur sur ${plays} l'a trouvé`
        : `${solved} joueurs sur ${plays} l'ont trouvé`,
    solveRateMany: (percent) => `${percent} % des joueurs l'ont trouvé`,
    whistlerCredit: (name) => `sifflé par ${name}`,
    anonymousWhistler: "un siffleur anonyme",
  },

  categories: {
    "Film": "Cinéma",
    "TV Series": "Série TV",
    "Video Games": "Jeux vidéo",
    "Jingle": "Jingle",
    "Music": "Musique",
  },

  // The scale climbs a wind, and that is what is translated — not the words. A
  // literal "Une brise" for "A Breeze" loses that these are named weather, so
  // the French rungs are the wind's own vocabulary, in the same order.
  difficulties: {
    "Trivial": "Sans effort",
    "A Breeze": "Petite brise",
    "Gust": "Coup de vent",
    "Storm": "Tempête",
    "Gasping for Air": "À bout de souffle",
    "Hurricane": "Ouragan",
  },
};

export const STRINGS: Record<Lang, Strings> = { fr, en };

export const stringsFor = (lang: Lang): Strings => STRINGS[lang];
