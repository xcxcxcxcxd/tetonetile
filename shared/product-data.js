// Technical data from the Zelligerar Technical Data Sheet and Installation Guide.
// Used on product pages, public QR pages (box labels) and printed quotes.

export const TECH_DATA = [
  { label: 'Water absorption (ASTM C373 / EN ISO 10545-3)', glazed: 'avg. 22.9 % - non-vitreous', natural: 'avg. 21.9 % - non-vitreous' },
  { label: 'DCOF dry (ANSI A326.3)', glazed: 'avg. 0.53', natural: 'Not tested' },
  { label: 'DCOF wet (ANSI A326.3)', glazed: 'avg. 0.25', natural: 'avg. 0.80' },
  { label: 'Freeze / thaw (ASTM C1026)', glazed: 'Not resistant', natural: 'Not resistant' },
  { label: 'UV resistance', glazed: 'Resistant', natural: 'Resistant' },
  { label: 'Acid resistance', glazed: 'Not resistant - pH-neutral cleaning only', natural: 'Not resistant - pH-neutral cleaning only' },
  { label: 'Heat resistance', glazed: 'Not resistant to direct heat', natural: 'Not resistant to direct heat' },
  { label: 'Radiant heating', glazed: 'Compatible', natural: 'Compatible' },
  { label: 'Reaction to fire (IBC 803)', glazed: 'Non-combustible, no smoke', natural: 'Non-combustible, no smoke' },
  { label: 'VOC emissions (LEED v4 / v4.1)', glazed: 'Inherently non-emitting', natural: 'Inherently non-emitting' },
];

// [application, glazed, natural, condition]   values: yes | cond | no
export const APPLICATIONS = [
  ['Interior wall', 'yes', 'yes', ''],
  ['Exterior wall', 'cond', 'cond', 'Overhead protection and water-repellent sealer in cold climates'],
  ['Interior floor - dry', 'yes', 'yes', 'Light commercial traffic maximum'],
  ['Interior floor - wet, entryway, mudroom', 'no', 'yes', 'Glazed does not meet the wet DCOF threshold'],
  ['Exterior floor', 'no', 'cond', 'Natural, bejmat format only; above grade, covered, sealed'],
  ['Bathroom floor', 'cond', 'yes', 'Glazed: dry zone only, outside the shower footprint'],
  ['Kitchen floor', 'no', 'yes', ''],
  ['Shower wall', 'yes', 'no', 'Waterproofing and penetrating sealer required'],
  ['Shower floor', 'cond', 'no', 'Anti-slip sealer or treatment, or a smaller module with wider joints'],
  ['Steam shower wall', 'yes', 'no', 'Waterproofing and penetrating sealer required'],
  ['Pool / fountain waterline', 'cond', 'no', 'Penetrating sealer required. Not for submerged installation'],
  ['Backsplash', 'cond', 'cond', 'Penetrating sealer at sinks; consult the installer near ranges'],
  ['Fireplace surround and hearth', 'yes', 'yes', 'Not inside fireplaces, pizza ovens or oven venting'],
  ['Radiant heated floor', 'yes', 'yes', ''],
  ['Steam shower floor / submerged / freeze-thaw', 'no', 'no', ''],
];

export const TRAFFIC = 'Class III - light commercial: offices, boutiques, consulting rooms, guest accommodation. Not for heavy commercial floors (hotel lobbies, main corridors, retail, restaurants).';

export const INSTALL_SEQUENCE = {
  glazed: [
    'Inspect on receipt; order 15-30 % overage',
    'Dry-lay and blend tiles from all boxes',
    'Soak 1-2 minutes in room-temperature water',
    'Back-butter, level and set (1/16″ walls · 1/8″ floors)',
    'Cure 48 hours',
    'Grout with Mapei Ultracolor Plus FA',
    'Pre-seal with 511 Porous Plus before grouting - wet areas, exteriors and contrasting grout',
  ],
  natural: [
    'Inspect on receipt; order 15-30 % overage',
    'Dry-lay and blend tiles from all boxes',
    'Do NOT soak',
    'Set in 2′ × 2′ sections; wipe thin-set immediately',
    'Cure 48 hours',
    'Pre-seal with 511 Porous Plus; cure 48 hours',
    'Grout with Mapei Flexcolor CQ',
    'Top-coat with FILA Matte Wax - interior only',
  ],
};

export const CARE = [
  'Clean with a mild pH-neutral soap. Test on a small area first.',
  'Never use acidic, bleach-based or abrasive cleaners; no steam cleaners on unglazed zellige.',
  'Keep floors free of abrasive debris and clean stains immediately (food, oils, paints, chemicals).',
  'Re-seal unglazed zellige, and glazed zellige in wet areas, every 1-2 years.',
  'A natural patina and traffic pattern develops with use - this is a characteristic of the material.',
];
