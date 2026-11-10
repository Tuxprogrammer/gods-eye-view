// Offense categories for the crime layer, shared by the server (which
// classifies report rows) and the client (which colors and counts them).
// Portable: no browser or Node dependencies.

/** Display order is severity order; a case takes its most severe charge. */
export const CRIME_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'violent', color: '#ef4444' }),
  Object.freeze({ id: 'property', color: '#f59e0b' }),
  Object.freeze({ id: 'drugs', color: '#a855f7' }),
  Object.freeze({ id: 'traffic', color: '#3b82f6' }),
  Object.freeze({ id: 'other', color: '#94a3b8' }),
]);

const CATEGORY_IDS = new Set(CRIME_CATEGORIES.map((category) => category.id));
const SEVERITY = new Map(
  CRIME_CATEGORIES.map((category, i) => [category.id, i]),
);

// Offenses whose block-level location could point at a victim (sex
// offenses, children, deaths, missing people). The server never publishes
// these cases; it only counts them.
const SENSITIVE =
  /\b(RAPE|SODOMY|SEX(UAL)?|INCEST|CHILD|CHINS|JUVENILE|RUNAWAY|MISSING|DEATH|SUICID|OBSCEN|PORNOGRAPH|ENTICING|MENTAL|ELDERLY)/;

const RULES = [
  // Service calls and checks that only look like offenses.
  ['other', /BACKGROUND CHECK|LOST AND FOUND|STRUCTURE FIRE|ANIMAL BITE/],
  // Traffic before drugs: DUI descriptions mention controlled substances.
  [
    'traffic',
    /DRIVING UNDER|\bDUI\b|LEAVING THE SCENE|DUTY TO STOP|DUTY UPON STRIKING|FLEEING|ELUDE|RECKLESS DRIV|TRAFFIC|LICENSE (SUSPENDED|REVOKED)|HIT AND RUN/,
  ],
  [
    'violent',
    /ASSAULT|ROBBERY|MURDER|HOMICIDE|MANSLAUGHTER|KIDNAP|DOMESTIC VIOLENCE|^DV\b|MENACING|STRANGULATION|SUFFOCATION|TERRORIST|STALKING|HARASS|HARRAS|INTIMIDATION|SHOOTING|DISCHARG|BODILY FLUIDS|SWATTING|RECKLESS ENDANGER/,
  ],
  [
    'property',
    /THEFT|BURGLARY|BREAKING AND ENTERING|^B&E\b|MISCHIEF|TRESPASS|FRAUD|FORG|STOLEN|SWINDLE|DECEPTION|SHOPLIFT|TAMPERING|ARSON|UNAUTHORIZED USE|REDELIVER|IMPERSONATION|EMBEZZL|VANDAL|BURGLARY TOOLS/,
  ],
  [
    'drugs',
    /MARIJUANA|CONTROLLED SUBSTANCE|DRUG|PARAPHERNALIA|METHAMPHETAMINE|NARCOTIC|AMPHETAMINE|COCAINE|HEROIN|FENTANYL|PRESCRIPTION|DRUNK|LIQUOR|ALCOHOL/,
  ],
];

/** True when a case with this offense must not be mapped. */
export function isSensitiveOffense(offense) {
  return SENSITIVE.test(String(offense || '').toUpperCase());
}

/** Category id for one offense description. */
export function classifyOffense(offense) {
  const text = String(offense || '').toUpperCase();
  for (const [id, pattern] of RULES) if (pattern.test(text)) return id;
  return 'other';
}

/** The most severe of several category ids. */
export function mostSevereCategory(ids) {
  let best = 'other';
  for (const id of ids)
    if (CATEGORY_IDS.has(id) && SEVERITY.get(id) < SEVERITY.get(best))
      best = id;
  return best;
}

export function crimeCategory(id) {
  return (
    CRIME_CATEGORIES.find((category) => category.id === id) ||
    CRIME_CATEGORIES[CRIME_CATEGORIES.length - 1]
  );
}
