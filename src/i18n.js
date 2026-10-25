// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration button, widget, connection status); `text(key, language,
// vars)` returns one string (feature names, select labels, scene action
// errors: Gladys does not send the language of the user with a scan, a
// command or a scene action, see `language` in config.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const MESSAGES = {
  // --- Feature names -----------------------------------------------------------
  feature_power: { en: 'Power', fr: 'Marche/veille', de: 'Ein/Standby', es: 'Encendido' },
  feature_volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  feature_mute: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silencio' },
  feature_play: { en: 'Play', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducir' },
  feature_pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  feature_previous: { en: 'Previous', fr: 'Précédent', de: 'Zurück', es: 'Anterior' },
  feature_next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  'feature_playback-state': {
    en: 'Playback',
    fr: 'État de la lecture',
    de: 'Wiedergabestatus',
    es: 'Estado de reproducción',
  },
  feature_source: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Fuente' },
  feature_title: { en: 'Now playing', fr: 'En cours', de: 'Aktueller Titel', es: 'Reproduciendo' },
  feature_artist: { en: 'Artist', fr: 'Artiste', de: 'Interpret', es: 'Artista' },
  'feature_music-title': { en: 'Title', fr: 'Titre', de: 'Titel', es: 'Título' },
  'feature_music-artist': {
    en: 'Track artist',
    fr: 'Artiste du morceau',
    de: 'Interpret des Titels',
    es: 'Artista de la pista',
  },
  feature_album: { en: 'Album', fr: 'Album', de: 'Album', es: 'Álbum' },
  feature_artwork: { en: 'Cover', fr: 'Pochette', de: 'Cover', es: 'Carátula' },
  feature_duration: { en: 'Duration', fr: 'Durée', de: 'Dauer', es: 'Duración' },
  feature_position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  'feature_music-mute': {
    en: 'Mute (player)',
    fr: 'Muet (lecteur)',
    de: 'Stumm (Player)',
    es: 'Silencio (reproductor)',
  },
  feature_bass: { en: 'Bass', fr: 'Graves', de: 'Bass', es: 'Graves' },
  feature_midrange: { en: 'Midrange', fr: 'Médiums', de: 'Mitten', es: 'Medios' },
  feature_treble: { en: 'Treble', fr: 'Aigus', de: 'Höhen', es: 'Agudos' },
  feature_center: { en: 'Centre', fr: 'Centre', de: 'Center', es: 'Central' },
  feature_surround: { en: 'Surround', fr: 'Surround', de: 'Surround', es: 'Envolvente' },
  feature_height: { en: 'Height', fr: 'Hauteur', de: 'Höhe', es: 'Altura' },
  feature_subwoofer: {
    en: 'Subwoofer',
    fr: 'Caisson de basses',
    de: 'Subwoofer',
    es: 'Subwoofer',
  },
  'feature_audio-mode': {
    en: 'Dialogue mode',
    fr: 'Mode dialogue',
    de: 'Dialogmodus',
    es: 'Modo diálogo',
  },
  feature_battery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  feature_charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },

  // --- Select labels and source names ------------------------------------------
  preset: { en: 'Preset', fr: 'Préréglage', de: 'Voreinstellung', es: 'Presintonía' },
  source_other: { en: 'Other', fr: 'Autre', de: 'Andere', es: 'Otra' },
  source_tv: { en: 'TV', fr: 'TV', de: 'TV', es: 'TV' },
  source_optical: { en: 'Optical', fr: 'Optique', de: 'Optisch', es: 'Óptica' },
  source_analog: {
    en: 'Analogue input',
    fr: 'Entrée analogique',
    de: 'Analogeingang',
    es: 'Entrada analógica',
  },
  source_aux: { en: 'AUX', fr: 'AUX', de: 'AUX', es: 'AUX' },
  playback_paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  playback_playing: { en: 'Playing', fr: 'En lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  standby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  mode_normal: { en: 'Normal', fr: 'Normal', de: 'Normal', es: 'Normal' },
  mode_dialog: { en: 'Dialogue', fr: 'Dialogue', de: 'Dialog', es: 'Diálogo' },
  mode_dynamic: {
    en: 'Dynamic dialogue',
    fr: 'Dialogue dynamique',
    de: 'Dynamischer Dialog',
    es: 'Diálogo dinámico',
  },

  // --- Connection status (Integrations page) -----------------------------------
  statusConnected: {
    en: '{count} of {total} Bose speaker(s) connected on the local network.',
    fr: '{count} enceinte(s) Bose sur {total} connectée(s) sur le réseau local.',
    de: '{count} von {total} Bose-Lautsprecher(n) im lokalen Netzwerk verbunden.',
    es: '{count} de {total} altavoz(ces) Bose conectado(s) en la red local.',
  },
  statusAllOff: {
    en: '{count} Bose speaker(s) known, none answering right now (unplugged or out of range?).',
    fr: '{count} enceinte(s) Bose connue(s), aucune ne répond pour l’instant (débranchée ou hors de portée ?).',
    de: '{count} Bose-Lautsprecher bekannt, derzeit antwortet keiner (Strom getrennt oder außer Reichweite?).',
    es: '{count} altavoz(ces) Bose conocido(s), ninguno responde ahora (¿desenchufado o fuera de alcance?).',
  },
  statusNoSpeaker: {
    en: 'Signed in to the Bose account. No speaker found yet: use “Test the account and search the speakers”.',
    fr: 'Connecté au compte Bose. Aucune enceinte trouvée pour l’instant : utilisez « Tester le compte et rechercher les enceintes ».',
    de: 'Mit dem Bose-Konto angemeldet. Noch kein Lautsprecher gefunden: Nutzen Sie „Konto testen und Lautsprecher suchen“.',
    es: 'Sesión iniciada en la cuenta Bose. Aún no se ha encontrado ningún altavoz: use «Probar la cuenta y buscar los altavoces».',
  },
  statusScanForbidden: {
    en: 'Gladys refused the network search: reinstall the integration and accept its network discovery, or type the address of the speaker.',
    fr: 'Gladys a refusé la recherche réseau : réinstallez l’intégration en acceptant sa découverte réseau, ou saisissez l’adresse de l’enceinte.',
    de: 'Gladys hat die Netzwerksuche abgelehnt: Installieren Sie die Integration neu und erlauben Sie die Netzwerkerkennung, oder geben Sie die Adresse des Lautsprechers ein.',
    es: 'Gladys rechazó la búsqueda en la red: reinstale la integración aceptando su detección de red, o escriba la dirección del altavoz.',
  },
  statusNoAccount: {
    en: 'Enter the e-mail and password of your Bose account: the speakers only accept a token of the account they belong to.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Bose : les enceintes n’acceptent qu’un jeton du compte auquel elles appartiennent.',
    de: 'Geben Sie E-Mail und Passwort Ihres Bose-Kontos ein: Die Lautsprecher akzeptieren nur ein Token des Kontos, zu dem sie gehören.',
    es: 'Introduzca el correo y la contraseña de su cuenta Bose: los altavoces solo aceptan un token de la cuenta a la que pertenecen.',
  },
  statusRejected: {
    en: 'Bose refused the e-mail or the password of the account. Check them in the configuration (no new attempt until then).',
    fr: 'Bose a refusé l’e-mail ou le mot de passe du compte. Vérifiez-les dans la configuration (aucune nouvelle tentative d’ici là).',
    de: 'Bose hat E-Mail oder Passwort des Kontos abgelehnt. Prüfen Sie sie in der Konfiguration (bis dahin kein neuer Versuch).',
    es: 'Bose rechazó el correo o la contraseña de la cuenta. Revíselos en la configuración (sin nuevos intentos hasta entonces).',
  },
  statusUnavailable: {
    en: 'The Bose sign-in service does not answer as expected; trying again in a few minutes. The speakers are controlled locally once a token is obtained.',
    fr: 'Le service de connexion Bose ne répond pas comme prévu ; nouvel essai dans quelques minutes. Les enceintes sont pilotées en local une fois le jeton obtenu.',
    de: 'Der Bose-Anmeldedienst antwortet nicht wie erwartet; neuer Versuch in einigen Minuten. Mit einem Token werden die Lautsprecher lokal gesteuert.',
    es: 'El servicio de inicio de sesión de Bose no responde como se esperaba; nuevo intento en unos minutos. Con un token, los altavoces se controlan en local.',
  },

  // --- Configuration button ----------------------------------------------------
  testOk: {
    en: 'Bose account OK. {count} speaker(s) found: {list}.',
    fr: 'Compte Bose OK. {count} enceinte(s) trouvée(s) : {list}.',
    de: 'Bose-Konto OK. {count} Lautsprecher gefunden: {list}.',
    es: 'Cuenta Bose correcta. {count} altavoz(ces) encontrado(s): {list}.',
  },
  testNone: {
    en: 'Bose account OK, but no speaker answered. Check that it is on the same network as Gladys, or type its address. Only the Bose Music speakers (Bose app) are supported: SoundTouch speakers need the “Bose SoundTouch” integration.',
    fr: 'Compte Bose OK, mais aucune enceinte n’a répondu. Vérifiez qu’elle est sur le même réseau que Gladys, ou saisissez son adresse. Seules les enceintes Bose Music (application Bose) sont prises en charge : les SoundTouch relèvent de l’intégration « Bose SoundTouch ».',
    de: 'Bose-Konto OK, aber kein Lautsprecher hat geantwortet. Prüfen Sie, ob er im selben Netzwerk wie Gladys ist, oder geben Sie seine Adresse ein. Nur Bose-Music-Lautsprecher (Bose-App) werden unterstützt: SoundTouch-Lautsprecher brauchen die Integration „Bose SoundTouch“.',
    es: 'Cuenta Bose correcta, pero ningún altavoz respondió. Compruebe que está en la misma red que Gladys, o escriba su dirección. Solo se admiten los altavoces Bose Music (aplicación Bose): los SoundTouch necesitan la integración «Bose SoundTouch».',
  },
  testUnreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },

  // --- Errors (commands, scene actions, widget toasts) -------------------------
  errorUnknownDevice: {
    en: 'This speaker is unknown to the integration: search the speakers again.',
    fr: 'Cette enceinte est inconnue de l’intégration : relancez la recherche des enceintes.',
    de: 'Dieser Lautsprecher ist der Integration unbekannt: Suchen Sie die Lautsprecher erneut.',
    es: 'Este altavoz es desconocido para la integración: busque de nuevo los altavoces.',
  },
  errorUnreachable: {
    en: '{name} does not answer: {error}',
    fr: '{name} ne répond pas : {error}',
    de: '{name} antwortet nicht: {error}',
    es: '{name} no responde: {error}',
  },
  errorRefused: {
    en: '{name} refused the command: {error}',
    fr: '{name} a refusé la commande : {error}',
    de: '{name} hat den Befehl abgelehnt: {error}',
    es: '{name} rechazó la orden: {error}',
  },
  errorNoAccount: {
    en: 'No valid Bose account token: check the e-mail and password in the configuration.',
    fr: 'Aucun jeton valide du compte Bose : vérifiez l’e-mail et le mot de passe dans la configuration.',
    de: 'Kein gültiges Token des Bose-Kontos: Prüfen Sie E-Mail und Passwort in der Konfiguration.',
    es: 'Ningún token válido de la cuenta Bose: revise el correo y la contraseña en la configuración.',
  },
  errorValue: {
    en: 'Value not accepted: {value}.',
    fr: 'Valeur non acceptée : {value}.',
    de: 'Wert nicht akzeptiert: {value}.',
    es: 'Valor no aceptado: {value}.',
  },
  errorPreset: {
    en: '{name} has no preset {preset}: save it in the Bose app first.',
    fr: '{name} n’a pas de préréglage {preset} : enregistrez-le d’abord dans l’application Bose.',
    de: '{name} hat keine Voreinstellung {preset}: Speichern Sie sie zuerst in der Bose-App.',
    es: '{name} no tiene la presintonía {preset}: guárdela primero en la aplicación Bose.',
  },
  errorGroupMaster: {
    en: '{name} follows another speaker: start the group from {master}.',
    fr: '{name} suit une autre enceinte : lancez le groupe depuis {master}.',
    de: '{name} folgt einem anderen Lautsprecher: Starten Sie die Gruppe von {master} aus.',
    es: '{name} sigue a otro altavoz: inicie el grupo desde {master}.',
  },
  errorGroupEmpty: {
    en: 'Choose at least one other speaker to group with {name}.',
    fr: 'Choisissez au moins une autre enceinte à grouper avec {name}.',
    de: 'Wählen Sie mindestens einen weiteren Lautsprecher für die Gruppe mit {name}.',
    es: 'Elija al menos otro altavoz para agrupar con {name}.',
  },
  errorNotGrouped: {
    en: '{name} is not in a group.',
    fr: '{name} n’est dans aucun groupe.',
    de: '{name} ist in keiner Gruppe.',
    es: '{name} no está en ningún grupo.',
  },
  errorNoMode: {
    en: '{name} has no dialogue mode {mode}.',
    fr: '{name} n’a pas de mode dialogue {mode}.',
    de: '{name} hat keinen Dialogmodus {mode}.',
    es: '{name} no tiene el modo diálogo {mode}.',
  },

  // --- Widget ------------------------------------------------------------------
  widgetChooseDevice: {
    en: 'Choose a Bose speaker in the settings of this widget.',
    fr: 'Choisissez une enceinte Bose dans les réglages de ce widget.',
    de: 'Wählen Sie in den Einstellungen dieses Widgets einen Bose-Lautsprecher.',
    es: 'Elija un altavoz Bose en los ajustes de este widget.',
  },
  widgetState: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  widgetPlaying: { en: 'Playing', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  widgetPaused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  widgetIdle: {
    en: 'On, idle',
    fr: 'Allumée, à l’arrêt',
    de: 'An, gestoppt',
    es: 'Encendido, parado',
  },
  widgetStandby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  widgetUnreachable: {
    en: 'Not answering',
    fr: 'Ne répond pas',
    de: 'Antwortet nicht',
    es: 'No responde',
  },
  widgetSource: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Fuente' },
  widgetVolume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  widgetMutedValue: { en: 'Muted', fr: 'Muet', de: 'Stumm', es: 'Silenciado' },
  widgetBattery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  widgetCharging: {
    en: '{percent} %, charging',
    fr: '{percent} %, en charge',
    de: '{percent} %, lädt',
    es: '{percent} %, cargando',
  },
  widgetGroup: { en: 'Group', fr: 'Groupe', de: 'Gruppe', es: 'Grupo' },
  widgetGroupLeads: {
    en: 'Leads {count} speaker(s)',
    fr: 'Pilote {count} enceinte(s)',
    de: 'Steuert {count} Lautsprecher',
    es: 'Dirige {count} altavoz(ces)',
  },
  widgetGroupFollows: {
    en: 'Follows {name}',
    fr: 'Suit {name}',
    de: 'Folgt {name}',
    es: 'Sigue a {name}',
  },
  widgetNothing: {
    en: 'Nothing is playing.',
    fr: 'Rien en cours de lecture.',
    de: 'Es wird nichts abgespielt.',
    es: 'No se reproduce nada.',
  },
  widgetOffline: {
    en: 'Plugged in and on the network?',
    fr: 'Branchée et sur le réseau ?',
    de: 'Eingesteckt und im Netzwerk?',
    es: '¿Enchufado y en la red?',
  },
  widgetArt: {
    en: 'Cover of what is playing',
    fr: 'Pochette de la lecture en cours',
    de: 'Cover des aktuellen Titels',
    es: 'Carátula de lo que suena',
  },
  widgetPrevious: { en: 'Previous', fr: 'Précédent', de: 'Zurück', es: 'Anterior' },
  widgetPlay: { en: 'Play', fr: 'Lecture', de: 'Abspielen', es: 'Reproducir' },
  widgetPause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  widgetNext: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  widgetMute: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
  widgetUnmute: { en: 'Unmute', fr: 'Son', de: 'Ton an', es: 'Activar sonido' },
  widgetPowerOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  widgetPowerOff: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  widgetDone: {
    en: 'Sent to {name}.',
    fr: 'Envoyé à {name}.',
    de: 'An {name} gesendet.',
    es: 'Enviado a {name}.',
  },
};

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description The name of a feature in one language.
 * @param {string} key - Feature key.
 * @param {string} language - Language code.
 * @returns {string} The name.
 */
export function featureName(key, language) {
  return MESSAGES[key] ? text(key, language) : key;
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
