// Names for new sessions nobody named: one whimsical lowercase word (`kelpie`, `ballyhoo`,
// `featherstar`). A web spawn without a name gets a word that no tmux session and no Claude
// session on this host is called yet; it is both the tmux session name and the Claude session
// name (`claude -n <word>`), so the session has its title from the start and auto-naming leaves
// it alone (a `-n` name counts as chosen — docs/architecture.md → "Session titles").
//
// `crates/fleet/src/core/words.rs` has the same list for `fleet spawn`; the tests on both sides
// check that the two lists are equal.
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The words, lowercase `a-z` only, at most 16 characters, no repeats. */
export const WORDS = [
  // creatures
  'aardvark', 'alpaca', 'anemone', 'armadillo', 'auklet', 'avocet', 'axolotl', 'badger',
  'barnacle', 'binturong', 'bittern', 'bobolink', 'bumblebee', 'capybara', 'caracal', 'chamois',
  'chickadee', 'chinchilla', 'cicada', 'coati', 'cormorant', 'cowrie', 'curlew', 'cuttlefish',
  'damselfly', 'dipper', 'dormouse', 'dragonfly', 'dugong', 'dunlin', 'egret', 'ermine',
  'fennec', 'firecrest', 'firefly', 'flamingo', 'frogmouth', 'fulmar', 'galah', 'gannet',
  'gecko', 'gerenuk', 'glowworm', 'godwit', 'goldcrest', 'guillemot', 'hedgehog', 'heron',
  'hoopoe', 'ibex', 'ibis', 'jerboa', 'kakapo', 'katydid', 'kelpie', 'kestrel',
  'kingfisher', 'kinkajou', 'kittiwake', 'kookaburra', 'lacewing', 'ladybird', 'lapwing', 'lemming',
  'limpet', 'linnet', 'lorikeet', 'lynx', 'magpie', 'manatee', 'margay', 'marmoset',
  'marten', 'mayfly', 'meerkat', 'mongoose', 'motmot', 'narwhal', 'nautilus', 'newt',
  'nightjar', 'nudibranch', 'nuthatch', 'ocelot', 'okapi', 'oriole', 'otter', 'pangolin',
  'periwinkle', 'petrel', 'phoebe', 'platypus', 'plover', 'potoo', 'puffin', 'quetzal',
  'quokka', 'salamander', 'sanderling', 'seahorse', 'serval', 'shearwater', 'siskin', 'skink',
  'starling', 'stoat', 'sunfish', 'swallowtail', 'takin', 'tamarin', 'tanager', 'tapir',
  'tardigrade', 'toucan', 'towhee', 'tuatara', 'urchin', 'vole', 'walrus', 'whelk',
  'whimbrel', 'wobbegong', 'wombat', 'wren',
  // plants
  'alder', 'aspen', 'bluebell', 'bracken', 'bramble', 'buttercup', 'camellia', 'catalpa',
  'chicory', 'clematis', 'clover', 'cloudberry', 'cowslip', 'damson', 'dewberry', 'edelweiss',
  'elderberry', 'feverfew', 'foxglove', 'gentian', 'ginkgo', 'gooseberry', 'gorse', 'harebell',
  'hawthorn', 'hazel', 'heather', 'hollyhock', 'honeysuckle', 'juniper', 'kumquat', 'larch',
  'larkspur', 'lavender', 'lichen', 'lingonberry', 'linden', 'loquat', 'lupine', 'magnolia',
  'marigold', 'meadowsweet', 'medlar', 'moonwort', 'myrtle', 'nutmeg', 'peony', 'persimmon',
  'primrose', 'quince', 'rosemary', 'rowan', 'saffron', 'samphire', 'saxifrage', 'sequoia',
  'snapdragon', 'sorrel', 'starwort', 'tamarack', 'tamarind', 'tansy', 'teasel', 'thistle',
  'toadflax', 'verbena', 'wisteria', 'woodruff', 'yarrow', 'zinnia',
  // weather and sky
  'aurora', 'breeze', 'chinook', 'cirrus', 'cumulus', 'dewdrop', 'drizzle', 'equinox',
  'flurry', 'gloaming', 'hailstone', 'hoarfrost', 'mistral', 'mizzle', 'monsoon', 'moonbow',
  'nimbus', 'rime', 'sirocco', 'sleet', 'snowdrift', 'solstice', 'squall', 'sundog',
  'tempest', 'thunderhead', 'twilight', 'zephyr', 'comet', 'nebula', 'pulsar', 'quasar',
  'zenith',
  // whimsical words
  'ballyhoo', 'bamboozle', 'brouhaha', 'bumbershoot', 'cattywampus', 'collywobbles', 'doohickey', 'flibbertigibbet',
  'folderol', 'gallimaufry', 'hootenanny', 'hullabaloo', 'kerfuffle', 'lollygag', 'rigmarole', 'skedaddle',
  'snollygoster', 'whirligig', 'widdershins', 'tatterdemalion',
  // made-up compounds
  'featherstar', 'moonpenny', 'thistledown', 'puddlejump', 'mosswhistle', 'cloudhopper', 'glimmerfen', 'frostfeather',
  'sunwhistle', 'nettlewick', 'starfern', 'dewlark', 'emberwing', 'fernlight', 'driftwood', 'honeydrift',
  'lanternfish', 'marshglow', 'pebblesnout', 'puddlefoot', 'quillfeather', 'rainspark', 'snowberry', 'stardrift',
  'sugarmoss', 'tidewhistle', 'velvetmoth', 'wanderwhisk', 'willowisp', 'windlebrook', 'bumblewick', 'glowfinch',
  'mistletoe', 'moonmoth', 'sparrowhawk',
];

/**
 * A random word from WORDS that is not in `taken`. When every word is taken, a random free
 * `<word>-2`, then `<word>-3`, and so on. `random` (like Math.random) picks among the free words.
 */
export function pickName(taken = [], random = Math.random) {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const free = WORDS.map((w) => (n === 1 ? w : `${w}-${n}`)).filter((c) => !used.has(c));
    if (free.length) return free[Math.floor(random() * free.length) % free.length];
  }
}

/** The `name` of every entry in Claude's session registry (`<claudeHome>/sessions/*.json`). */
export async function registryNames(claudeHome) {
  const dir = path.join(claudeHome, 'sessions');
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const names = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const { name } = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      if (typeof name === 'string' && name) names.push(name);
    } catch {
      /* a half-written or vanished entry */
    }
  }
  return names;
}
