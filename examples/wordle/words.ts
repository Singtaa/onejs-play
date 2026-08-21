/**
 * The word list.
 *
 * One list serves as both the answer pool and the accepted-guess set. A real
 * Wordle uses a small curated answer list and a much larger guess list; that is
 * a content decision, not a code one, and the shape here supports both.
 */
export const WORDS: readonly string[] = [
    "ABOUT", "ALERT", "ARGUE", "BEACH", "BRAIN", "BRAND", "BREAD", "BRICK", "BRING", "BROAD",
    "BROWN", "BUILD", "CABLE", "CHAIR", "CHART", "CHASE", "CHEAP", "CHECK", "CHEST", "CHIEF",
    "CHILD", "CLAIM", "CLASS", "CLEAN", "CLEAR", "CLICK", "CLIMB", "CLOCK", "CLOSE", "COAST",
    "COURT", "COVER", "CRACK", "CRAFT", "CRANE", "CRASH", "CRAZY", "CREAM", "CRIME", "CROSS", "CROWD",
    "CROWN", "CURVE", "CYCLE", "DAILY", "DANCE", "DEALT", "DEPTH", "DOUBT", "DOZEN", "DRAFT",
    "DRAIN", "DRAMA", "DREAM", "DRESS", "DRINK", "DRIVE", "EAGER", "EARLY", "EARTH", "EIGHT",
    "ELITE", "EMPTY", "ENEMY", "ENJOY", "ENTER", "ENTRY", "EQUAL", "ERROR", "EVENT", "EVERY",
    "EXACT", "EXIST", "EXTRA", "FAITH", "FALSE", "FAULT", "FIELD", "FIFTH", "FIGHT", "FINAL",
    "FIRST", "FLAME", "FLASH", "FLEET", "FLOOR", "FOCUS", "FORCE", "FORTH", "FRAME", "FRANK",
    "FRESH", "FRONT", "FRUIT", "FUNNY", "GHOST", "GIANT", "GIVEN", "GLASS", "GRACE", "GRADE",
    "GRAND", "GRANT", "GRASS", "GREAT", "GREEN", "GROSS", "GROUP", "GUARD", "GUESS", "GUEST",
    "GUIDE", "HAPPY", "HEART", "HEAVY", "HORSE", "HOTEL", "HOUSE", "HUMAN", "IDEAL", "IMAGE",
    "INDEX", "INNER", "INPUT", "ISSUE", "JOINT", "JUDGE", "KNIFE", "KNOCK", "KNOWN", "LARGE",
    "LASER", "LAUGH", "LAYER", "LEARN", "LEASE", "LEAST", "LEAVE", "LEGAL", "LEVEL", "LIGHT",
    "LIMIT", "LOCAL", "LOGIC", "LOOSE", "LOWER", "LUCKY", "LUNCH", "MAGIC", "MAJOR", "MAKER",
    "MARCH", "MATCH", "MAYBE", "MAYOR", "MEDIA", "METAL", "MIGHT", "MINOR", "MIXED", "MODEL",
    "MONEY", "MONTH", "MORAL", "MOTOR", "MOUNT", "MOUSE", "MOUTH", "MOVIE", "MUSIC", "NEVER",
    "NIGHT", "NOISE", "NORTH", "NOVEL", "NURSE", "OCEAN", "OFFER", "OFTEN", "ORDER", "OTHER",
    "OUGHT", "PAINT", "PANEL", "PAPER", "PARTY", "PEACE", "PHASE", "PHONE", "PHOTO", "PIANO",
    "PIECE", "PILOT", "PITCH", "PLACE", "PLAIN", "PLANE", "PLANT", "PLATE", "POINT", "POUND",
    "POWER", "PRESS", "PRICE", "PRIDE", "PRIME", "PRINT", "PRIOR", "PRIZE", "PROOF", "PROUD",
    "PROVE", "QUEEN", "QUICK", "QUIET", "QUITE", "RADIO", "RAISE", "RANGE", "RAPID", "RATIO",
    "REACH", "READY", "REFER", "RIGHT", "RIVER", "ROBOT", "ROUGH", "ROUND", "ROUTE", "ROYAL",
    "RURAL", "SCALE", "SCENE", "SCOPE", "SCORE", "SENSE", "SERVE", "SEVEN", "SHADE", "SHAKE",
    "SHALL", "SHAPE", "SHARE", "SHARP", "SHEET", "SHELF", "SHIFT", "SHINE", "SHIRT", "SHOCK",
    "SHOOT", "SHORT", "SIGHT", "SILLY", "SINCE", "SIXTH", "SKILL", "SLEEP", "SLIDE", "SMALL",
    "SMART", "SMILE", "SMOKE", "SOLID", "SOLVE", "SORRY", "SOUND", "SOUTH", "SPACE", "SPARE",
    "SPEAK", "SPEED", "SPEND", "SPENT", "SPLIT", "SPOKE", "SPORT", "STAFF", "STAGE", "STAKE",
    "STAND", "START", "STATE", "STEAM", "STEEL", "STICK", "STILL", "STOCK", "STONE", "STORE",
    "STORM", "STORY", "STRIP", "STUCK", "STUDY", "STUFF", "STYLE", "SUGAR", "SUITE", "SUPER",
    "SWEET", "TABLE", "TAKEN", "TASTE", "TEACH", "THANK", "THEFT", "THEIR", "THEME", "THERE",
    "THESE", "THICK", "THING", "THINK", "THIRD", "THOSE", "THREE", "THROW", "TIGHT", "TIMER",
    "TIRED", "TITLE", "TODAY", "TOPIC", "TOTAL", "TOUCH", "TOUGH", "TOWER", "TRACK", "TRADE",
    "TRAIN", "TREAT", "TREND", "TRIAL", "TRIBE", "TRICK", "TRIED", "TRUCK", "TRULY", "TRUST",
    "TRUTH", "TWICE", "UNDER", "UNION", "UNITY", "UNTIL", "UPPER", "UPSET", "URBAN", "USAGE",
    "USUAL", "VALID", "VALUE", "VIDEO", "VISIT", "VITAL", "VOICE", "WASTE", "WATCH", "WATER",
    "WHEEL", "WHERE", "WHICH", "WHILE", "WHITE", "WHOLE", "WHOSE", "WOMAN", "WORLD", "WORRY",
    "WORSE", "WORST", "WORTH", "WOULD", "WRITE", "WRONG", "YIELD", "YOUNG", "YOUTH",
]
