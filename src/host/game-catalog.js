// Host-facing game library. Durations and team counts are provisional: edit them here.
export const GAME_ESTIMATES = {
  guessAge: { duration: '10–12 min', teams: '2+ teams' },
  noContext: { duration: '15–20 min', teams: '3+ teams' },
  iBetYou: { duration: '10–15 min', teams: '2+ teams, grouped' },
  perfectLie: { duration: '2–3 min per question', teams: '3+ teams' },
}

// New Game Nights start with these games, in this order.
export const RECOMMENDED_LINEUP = ['guessAge', 'noContext', 'iBetYou']

export const STARTER_CELEBRITIES = [
  { name: 'Pedro Pascal', dob: '1975-04-02', image: '' }, { name: 'Zendaya', dob: '1996-09-01', image: '' },
  { name: 'Robert Downey Jr.', dob: '1965-04-04', image: '' }, { name: 'Cristiano Ronaldo', dob: '1985-02-05', image: '' },
  { name: 'Tom Holland', dob: '1996-06-01', image: '' }, { name: 'Scarlett Johansson', dob: '1984-11-22', image: '' },
  { name: 'Ryan Reynolds', dob: '1976-10-23', image: '' }, { name: 'Lionel Messi', dob: '1987-06-24', image: '' },
  { name: 'Florence Pugh', dob: '1996-01-03', image: '' }, { name: 'Samuel L. Jackson', dob: '1948-12-21', image: '' },
]

const art = {
  guessAge: `<svg viewBox="0 0 160 120" aria-hidden="true" focusable="false"><defs><linearGradient id="gnArtGa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><circle cx="80" cy="62" r="44" fill="url(#gnArtGa)" opacity=".18"/><rect x="46" y="58" width="68" height="34" rx="9" fill="url(#gnArtGa)"/><rect x="46" y="70" width="68" height="6" fill="#0b1324" opacity=".25"/><rect x="60" y="40" width="7" height="18" rx="3" fill="#ccfbf1"/><rect x="77" y="36" width="7" height="22" rx="3" fill="#ccfbf1"/><rect x="94" y="40" width="7" height="18" rx="3" fill="#ccfbf1"/><path d="M63.5 30c3 4 3 7 0 9-3-2-3-5 0-9zM80.5 26c3 4 3 7 0 9-3-2-3-5 0-9zM97.5 30c3 4 3 7 0 9-3-2-3-5 0-9z" fill="#fde68a"/><text x="122" y="44" font-family="Space Grotesk,Inter,sans-serif" font-size="26" font-weight="700" fill="#99f6e4">?</text></svg>`,
  noContext: `<svg viewBox="0 0 160 120" aria-hidden="true" focusable="false"><defs><linearGradient id="gnArtNc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs><circle cx="80" cy="60" r="44" fill="url(#gnArtNc)" opacity=".18"/><rect x="34" y="30" width="62" height="48" rx="8" fill="#1e1438" stroke="url(#gnArtNc)" stroke-width="4"/><path d="M40 72l16-18 11 12 8-8 15 14z" fill="url(#gnArtNc)"/><circle cx="80" cy="44" r="5" fill="#ede9fe"/><path d="M90 58h40a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10h-18l-12 10v-10h-10a10 10 0 0 1-10-10V68a10 10 0 0 1 10-10z" fill="url(#gnArtNc)"/><circle cx="102" cy="75" r="3.5" fill="#1e1438"/><circle cx="114" cy="75" r="3.5" fill="#1e1438"/><circle cx="126" cy="75" r="3.5" fill="#1e1438"/></svg>`,
  iBetYou: `<svg viewBox="0 0 160 120" aria-hidden="true" focusable="false"><defs><linearGradient id="gnArtIb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdba74"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs><path d="M80 6l38 104H42z" fill="#fed7aa" opacity=".12"/><circle cx="80" cy="64" r="40" fill="url(#gnArtIb)" opacity=".16"/><rect x="68" y="30" width="24" height="40" rx="12" fill="url(#gnArtIb)"/><path d="M68 44h24M68 52h24" stroke="#2a1608" stroke-width="2.5" opacity=".35"/><path d="M60 58a20 20 0 0 0 40 0" fill="none" stroke="#fdba74" stroke-width="4" stroke-linecap="round"/><path d="M80 78v16M68 96h24" stroke="#fdba74" stroke-width="4" stroke-linecap="round"/><circle cx="124" cy="38" r="13" fill="#2a1608" stroke="#fdba74" stroke-width="3"/><text x="124" y="44" text-anchor="middle" font-family="Space Grotesk,Inter,sans-serif" font-size="15" font-weight="700" fill="#fdba74">7</text></svg>`,
  perfectLie: `<svg viewBox="0 0 160 120" aria-hidden="true" focusable="false"><defs><linearGradient id="gnArtTl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fda4af"/><stop offset="1" stop-color="#9f1239"/></linearGradient></defs><circle cx="80" cy="60" r="44" fill="url(#gnArtTl)" opacity=".16"/><rect x="40" y="28" width="46" height="64" rx="7" transform="rotate(-12 63 60)" fill="#2a0d17" stroke="#fda4af" stroke-width="3"/><rect x="74" y="26" width="46" height="64" rx="7" transform="rotate(10 97 58)" fill="url(#gnArtTl)"/><text x="97" y="68" text-anchor="middle" transform="rotate(10 97 58)" font-family="Space Grotesk,Inter,sans-serif" font-size="30" font-weight="700" fill="#2a0d17">?</text><text x="62" y="68" text-anchor="middle" transform="rotate(-12 63 60)" font-family="Space Grotesk,Inter,sans-serif" font-size="22" font-weight="700" fill="#fda4af">✓</text></svg>`,
}

export const GAME_CATALOG = {
  guessAge: {
    type: 'guessAge', gameType: 'guess_age', name: 'Guess the Age', icon: '🎂',
    description: 'A famous face on screen. How old are they really?',
    howToPlay: [
      'A celebrity appears on the big screen.',
      'Each Team Captain has 15 seconds to lock in an age.',
      'The closer the guess, the more points: exact age 10, one year out 8, two out 6, three out 5, within five 3, within ten 1.',
    ],
  },
  noContext: {
    type: 'noContext', gameType: 'no_context', name: 'No Context', icon: '💬',
    description: 'Five strange pictures, zero explanation. Funniest caption wins.',
    howToPlay: [
      'Teams get 45 seconds to write a caption for each picture.',
      'Captions are shown anonymously, then teams have 30 seconds to vote for a favourite (not their own).',
      'Each round the podium scores 5, 3 and 1 points. Five rounds in total.',
    ],
  },
  iBetYou: {
    type: 'iBetYou', gameType: 'i_bet_you', name: 'I Bet You', icon: '🎤',
    description: 'Bid, bluff and back it up on stage against the clock.',
    howToPlay: [
      'Teams are grouped and each group gets a category.',
      'Teams outbid each other: “I bet you we can name 7!” until someone says “Name them!”.',
      'The bidder has 60 seconds on stage. Success earns them 5 points; if they fail, the challenger takes the 5.',
    ],
  },
  perfectLie: {
    type: 'perfectLie', gameType: 'perfect_lie', name: 'Table of Lies', icon: '🃏',
    description: 'One answer is true. The rest were made up at the table.',
    howToPlay: [
      'Teams first try to guess the real answer to a question.',
      'Then every team writes a believable lie. All answers are shuffled together.',
      'Teams vote for the truth: 3 points for finding it, plus 2 points for every team fooled by your lie.',
    ],
  },
}

for (const [type, game] of Object.entries(GAME_CATALOG)) Object.assign(game, GAME_ESTIMATES[type], { art: art[type] })

export const GAME_ORDER = ['guessAge', 'noContext', 'iBetYou', 'perfectLie']
export const TYPE_FOR_GAME_TYPE = Object.fromEntries(Object.values(GAME_CATALOG).map(game => [game.gameType, game.type]))
export const toGameTypes = types => types.map(type => GAME_CATALOG[type]?.gameType).filter(Boolean)
