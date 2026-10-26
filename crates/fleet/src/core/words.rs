//! Names for new sessions nobody named: one whimsical lowercase word
//! (`kelpie`, `ballyhoo`, `featherstar`).
//!
//! A spawn without `--name` gets a word that no tmux session and no Claude
//! session on this machine is called yet. It is both the tmux session name and
//! the Claude session name (`claude -n <word>`), so the session has its title
//! from the start. Claude records a `-n` name as chosen (`name_source` is not
//! `derived`), so `display_title` shows it and auto-naming (`fleet name --all`,
//! the dashboard) leaves it alone: the word sticks until someone renames it.
//!
//! `web/lib/names.mjs` has the same list for the web spawn; the tests on both
//! sides check that the two lists are equal.

use std::hash::{BuildHasher, Hasher};

use crate::core::discovery;

/// The words, lowercase `a-z` only, at most 16 characters, no repeats.
pub const WORDS: &[&str] = &[
    // creatures
    "aardvark",
    "alpaca",
    "anemone",
    "armadillo",
    "auklet",
    "avocet",
    "axolotl",
    "badger",
    "barnacle",
    "binturong",
    "bittern",
    "bobolink",
    "bumblebee",
    "capybara",
    "caracal",
    "chamois",
    "chickadee",
    "chinchilla",
    "cicada",
    "coati",
    "cormorant",
    "cowrie",
    "curlew",
    "cuttlefish",
    "damselfly",
    "dipper",
    "dormouse",
    "dragonfly",
    "dugong",
    "dunlin",
    "egret",
    "ermine",
    "fennec",
    "firecrest",
    "firefly",
    "flamingo",
    "frogmouth",
    "fulmar",
    "galah",
    "gannet",
    "gecko",
    "gerenuk",
    "glowworm",
    "godwit",
    "goldcrest",
    "guillemot",
    "hedgehog",
    "heron",
    "hoopoe",
    "ibex",
    "ibis",
    "jerboa",
    "kakapo",
    "katydid",
    "kelpie",
    "kestrel",
    "kingfisher",
    "kinkajou",
    "kittiwake",
    "kookaburra",
    "lacewing",
    "ladybird",
    "lapwing",
    "lemming",
    "limpet",
    "linnet",
    "lorikeet",
    "lynx",
    "magpie",
    "manatee",
    "margay",
    "marmoset",
    "marten",
    "mayfly",
    "meerkat",
    "mongoose",
    "motmot",
    "narwhal",
    "nautilus",
    "newt",
    "nightjar",
    "nudibranch",
    "nuthatch",
    "ocelot",
    "okapi",
    "oriole",
    "otter",
    "pangolin",
    "periwinkle",
    "petrel",
    "phoebe",
    "platypus",
    "plover",
    "potoo",
    "puffin",
    "quetzal",
    "quokka",
    "salamander",
    "sanderling",
    "seahorse",
    "serval",
    "shearwater",
    "siskin",
    "skink",
    "starling",
    "stoat",
    "sunfish",
    "swallowtail",
    "takin",
    "tamarin",
    "tanager",
    "tapir",
    "tardigrade",
    "toucan",
    "towhee",
    "tuatara",
    "urchin",
    "vole",
    "walrus",
    "whelk",
    "whimbrel",
    "wobbegong",
    "wombat",
    "wren",
    // plants
    "alder",
    "aspen",
    "bluebell",
    "bracken",
    "bramble",
    "buttercup",
    "camellia",
    "catalpa",
    "chicory",
    "clematis",
    "clover",
    "cloudberry",
    "cowslip",
    "damson",
    "dewberry",
    "edelweiss",
    "elderberry",
    "feverfew",
    "foxglove",
    "gentian",
    "ginkgo",
    "gooseberry",
    "gorse",
    "harebell",
    "hawthorn",
    "hazel",
    "heather",
    "hollyhock",
    "honeysuckle",
    "juniper",
    "kumquat",
    "larch",
    "larkspur",
    "lavender",
    "lichen",
    "lingonberry",
    "linden",
    "loquat",
    "lupine",
    "magnolia",
    "marigold",
    "meadowsweet",
    "medlar",
    "moonwort",
    "myrtle",
    "nutmeg",
    "peony",
    "persimmon",
    "primrose",
    "quince",
    "rosemary",
    "rowan",
    "saffron",
    "samphire",
    "saxifrage",
    "sequoia",
    "snapdragon",
    "sorrel",
    "starwort",
    "tamarack",
    "tamarind",
    "tansy",
    "teasel",
    "thistle",
    "toadflax",
    "verbena",
    "wisteria",
    "woodruff",
    "yarrow",
    "zinnia",
    // weather and sky
    "aurora",
    "breeze",
    "chinook",
    "cirrus",
    "cumulus",
    "dewdrop",
    "drizzle",
    "equinox",
    "flurry",
    "gloaming",
    "hailstone",
    "hoarfrost",
    "mistral",
    "mizzle",
    "monsoon",
    "moonbow",
    "nimbus",
    "rime",
    "sirocco",
    "sleet",
    "snowdrift",
    "solstice",
    "squall",
    "sundog",
    "tempest",
    "thunderhead",
    "twilight",
    "zephyr",
    "comet",
    "nebula",
    "pulsar",
    "quasar",
    "zenith",
    // whimsical words
    "ballyhoo",
    "bamboozle",
    "brouhaha",
    "bumbershoot",
    "cattywampus",
    "collywobbles",
    "doohickey",
    "flibbertigibbet",
    "folderol",
    "gallimaufry",
    "hootenanny",
    "hullabaloo",
    "kerfuffle",
    "lollygag",
    "rigmarole",
    "skedaddle",
    "snollygoster",
    "whirligig",
    "widdershins",
    "tatterdemalion",
    // made-up compounds
    "featherstar",
    "moonpenny",
    "thistledown",
    "puddlejump",
    "mosswhistle",
    "cloudhopper",
    "glimmerfen",
    "frostfeather",
    "sunwhistle",
    "nettlewick",
    "starfern",
    "dewlark",
    "emberwing",
    "fernlight",
    "driftwood",
    "honeydrift",
    "lanternfish",
    "marshglow",
    "pebblesnout",
    "puddlefoot",
    "quillfeather",
    "rainspark",
    "snowberry",
    "stardrift",
    "sugarmoss",
    "tidewhistle",
    "velvetmoth",
    "wanderwhisk",
    "willowisp",
    "windlebrook",
    "bumblewick",
    "glowfinch",
    "mistletoe",
    "moonmoth",
    "sparrowhawk",
];

/// A random word from [`WORDS`] that is not in `taken`. When every word is
/// taken, a random free `<word>-2`, then `<word>-3`, and so on. `seed` picks
/// among the free words, so the choice is testable.
pub fn pick(taken: &[String], seed: u64) -> String {
    let mut n = 1u32;
    loop {
        let free: Vec<String> = WORDS
            .iter()
            .map(|w| {
                if n == 1 {
                    (*w).to_string()
                } else {
                    format!("{w}-{n}")
                }
            })
            .filter(|c| !taken.contains(c))
            .collect();
        if !free.is_empty() {
            return free[(seed % free.len() as u64) as usize].clone();
        }
        n += 1;
    }
}

/// A word for a new session on this machine: free among the tmux session names
/// and the names in Claude's session registry (`~/.claude/sessions/*.json`).
pub fn fresh() -> String {
    pick(&taken_names(), seed())
}

/// [`fresh`], also avoiding `extra` — for a [workspace](crate::core::workspace) handle, the
/// folders and branches that already carry a word.
pub fn fresh_avoiding(extra: &[String]) -> String {
    let mut taken = taken_names();
    taken.extend_from_slice(extra);
    pick(&taken, seed())
}

/// Every name a new session's word must not collide with. In fixture mode the
/// live tmux server is not asked.
fn taken_names() -> Vec<String> {
    let mut taken = if discovery::is_fixture() {
        Vec::new()
    } else {
        crate::core::backend::tmux_session_names()
    };
    let dir = discovery::claude_home().join("sessions");
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("name")?.as_str().map(str::to_string))
        else {
            continue;
        };
        taken.push(name);
    }
    taken
}

fn seed() -> u64 {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    h.write_u128(nanos);
    h.write_u32(std::process::id());
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The web spawn's copy of the list (`web/lib/names.mjs`).
    const WEB: &str = include_str!("../../../../web/lib/names.mjs");

    #[test]
    fn words_are_short_lowercase_and_unique() {
        assert!(WORDS.len() >= 200, "{} words", WORDS.len());
        for w in WORDS {
            assert!(
                !w.is_empty() && w.len() <= 16 && w.bytes().all(|b| b.is_ascii_lowercase()),
                "{w}"
            );
        }
        let mut sorted = WORDS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), WORDS.len(), "a word is listed twice");
    }

    #[test]
    fn the_web_spawn_has_the_same_words() {
        let body = WEB
            .split_once("export const WORDS = [")
            .and_then(|(_, rest)| rest.split_once("];"))
            .map(|(list, _)| list)
            .expect("WORDS in web/lib/names.mjs");
        let web: Vec<&str> = body
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .flat_map(|l| l.split(','))
            .map(|w| w.trim().trim_matches('\''))
            .filter(|w| !w.is_empty())
            .collect();
        assert_eq!(web, WORDS);
    }

    #[test]
    fn pick_skips_taken_names() {
        let taken: Vec<String> = WORDS.iter().skip(1).map(|w| (*w).to_string()).collect();
        for seed in 0..50 {
            assert_eq!(pick(&taken, seed), WORDS[0]);
        }
        assert!(WORDS.contains(&pick(&[], 7).as_str()));
        assert_ne!(pick(&[], 0), pick(&[], 1), "the seed picks the word");
    }

    #[test]
    fn pick_suffixes_once_every_word_is_taken() {
        let mut taken: Vec<String> = WORDS.iter().map(|w| (*w).to_string()).collect();
        let second = pick(&taken, 3);
        assert!(second.ends_with("-2"), "{second}");
        assert!(WORDS.contains(&second.trim_end_matches("-2")));
        taken.extend(WORDS.iter().map(|w| format!("{w}-2")));
        assert!(pick(&taken, 3).ends_with("-3"));
    }
}
