// The committed, generic wrong answers CLIP chooses between (#56), next to a
// pack's own answers, which are added at run time and never committed.
//
// Never built from, or limited to, a day's real answers: it's a broad list of
// everyday things, so its being public says nothing about any puzzle. An
// answer that's also on it is simply listed once (labels.ts).
//
// Textures and scenery come first on purpose. A tight crop usually shows fur,
// bark or sand, and with those on the list CLIP can be wrong the way a player
// is, instead of being forced to name an object. No category words ("animal",
// "fruit", "building"): they'd beat the specific answer at full view without
// being a right answer (labels.test.ts checks).

const TEXTURES_AND_SCENERY = [
  "grass", "moss", "sand", "gravel", "pebbles", "rock", "cliff", "boulder", "soil", "mud",
  "snow", "ice", "water", "waves", "ocean", "lake", "river", "waterfall", "puddle", "sky",
  "clouds", "fog", "sunset", "starry sky", "leaves", "tree bark", "branches", "pine needles", "hay", "straw",
  "wood grain", "wooden floor", "brick wall", "stone wall", "concrete", "asphalt road", "cobblestones", "tiles", "marble", "metal sheet",
  "rusty metal", "chain-link fence", "wooden fence", "rope", "cable", "wire", "glass window", "mirror", "curtain", "fabric",
  "knitted wool", "denim", "leather", "carpet", "paper", "cardboard", "plastic", "paint", "smoke", "fire",
  "desert", "forest", "meadow", "hill", "mountain", "volcano", "canyon", "cave", "island", "beach",
];

const ANIMALS = [
  "dog", "cat", "horse", "cow", "pig", "sheep", "goat", "chicken", "duck", "goose",
  "turkey", "rabbit", "hamster", "mouse", "rat", "squirrel", "chipmunk", "beaver", "raccoon", "fox",
  "wolf", "coyote", "bear", "polar bear", "panda", "koala", "kangaroo", "monkey", "gorilla", "chimpanzee",
  "orangutan", "lion", "tiger", "leopard", "cheetah", "jaguar", "lynx", "zebra", "giraffe", "elephant",
  "rhinoceros", "hippopotamus", "camel", "llama", "alpaca", "deer", "moose", "elk", "bison", "antelope",
  "gazelle", "donkey", "hedgehog", "porcupine", "skunk", "otter", "seal", "sea lion", "walrus", "dolphin",
  "whale", "orca", "shark", "octopus", "squid", "jellyfish", "crab", "lobster", "shrimp", "starfish",
  "sea turtle", "tortoise", "snake", "lizard", "iguana", "chameleon", "crocodile", "alligator", "frog", "toad",
  "salamander", "goldfish", "clownfish", "salmon", "trout", "eagle", "hawk", "owl", "parrot", "peacock",
  "flamingo", "penguin", "pigeon", "sparrow", "robin", "crow", "swan", "pelican", "seagull", "hummingbird",
  "ostrich", "woodpecker", "toucan", "bat", "butterfly", "moth", "bee", "wasp", "ant", "ladybug",
  "beetle", "dragonfly", "grasshopper", "spider", "snail", "scorpion", "caterpillar", "earthworm",
];

const FOOD_AND_DRINK = [
  "apple", "banana", "orange", "lemon", "lime", "grapefruit", "grape", "cherry", "strawberry", "raspberry",
  "blueberry", "blackberry", "cranberry", "watermelon", "cantaloupe", "pineapple", "mango", "papaya", "kiwi", "peach",
  "plum", "apricot", "pear", "pomegranate", "fig", "coconut", "avocado", "passion fruit", "dragon fruit", "lychee",
  "guava", "persimmon", "starfruit", "tangerine", "olive", "tomato", "carrot", "potato", "sweet potato", "onion",
  "garlic", "cabbage", "lettuce", "spinach", "kale", "broccoli", "cauliflower", "cucumber", "zucchini", "eggplant",
  "pumpkin", "butternut squash", "bell pepper", "chili pepper", "corn", "peas", "green beans", "asparagus", "celery", "radish",
  "beet", "mushroom", "artichoke", "leek", "ginger", "bread", "baguette", "croissant", "bagel", "pretzel",
  "donut", "muffin", "cupcake", "cake", "cookie", "pancake", "waffle", "pie", "pizza", "hamburger",
  "hot dog", "sandwich", "taco", "burrito", "sushi", "ramen", "spaghetti", "dumplings", "rice", "salad",
  "soup", "french fries", "popcorn", "cheese", "butter", "egg", "bacon", "sausage", "steak", "fried chicken",
  "ice cream", "chocolate", "candy", "honey", "jam", "cereal", "oatmeal", "peanuts", "almonds", "walnuts",
  "coffee beans", "cup of coffee", "tea", "orange juice", "milk", "wine", "beer", "lemonade",
];

const PLANTS = [
  "rose", "tulip", "sunflower", "daisy", "lily", "orchid", "lotus", "lavender", "dandelion", "poppy",
  "cherry blossom", "magnolia", "hibiscus", "daffodil", "carnation", "marigold", "cactus", "succulent", "aloe vera", "fern",
  "ivy", "bamboo", "palm tree", "pine tree", "oak tree", "maple leaf", "willow tree", "birch tree", "redwood tree", "bonsai",
  "clover", "seaweed", "coral", "pinecone", "acorn", "wheat", "vineyard", "hay bale", "tumbleweed", "lily pad",
];

const OBJECTS = [
  "chair", "table", "sofa", "bed", "pillow", "blanket", "lamp", "clock", "alarm clock", "wristwatch",
  "door", "window", "staircase", "ladder", "umbrella", "backpack", "suitcase", "handbag", "wallet", "key",
  "padlock", "scissors", "hammer", "screwdriver", "wrench", "saw", "drill", "nails", "shovel", "rake",
  "broom", "bucket", "watering can", "garden hose", "candle", "lantern", "flashlight", "light bulb", "battery", "smartphone",
  "laptop", "computer keyboard", "computer mouse", "television", "remote control", "camera", "headphones", "microphone", "loudspeaker", "guitar",
  "piano", "violin", "drum", "trumpet", "saxophone", "flute", "harp", "book", "notebook", "pencil",
  "pen", "crayons", "paintbrush", "envelope", "map", "globe", "calculator", "ruler", "stapler", "paper clip",
  "cup", "mug", "plate", "bowl", "fork", "spoon", "knife", "chopsticks", "teapot", "kettle",
  "frying pan", "cooking pot", "oven", "microwave", "refrigerator", "toaster", "blender", "wine glass", "bottle", "jar",
  "basket", "vase", "picture frame", "painting", "sculpture", "teddy bear", "doll", "soccer ball", "basketball", "baseball",
  "tennis ball", "tennis racket", "baseball bat", "skateboard", "surfboard", "skis", "snowboard", "helmet", "kite", "balloon",
  "dice", "chess pieces", "playing cards", "jigsaw puzzle", "hat", "baseball cap", "scarf", "gloves", "socks", "shoe",
  "boots", "sneakers", "sandals", "shirt", "dress", "jacket", "jeans", "necktie", "sunglasses", "eyeglasses",
  "ring", "necklace", "earrings", "buttons", "zipper", "coins", "toothbrush", "soap", "towel", "bathtub",
  "sink", "toilet", "comb", "hairbrush", "mailbox", "trash can", "fire hydrant", "traffic light", "street lamp", "bench",
  "fountain", "swing", "slide", "tent", "campfire", "hammock", "anchor", "compass", "telescope", "binoculars",
  "microscope", "magnifying glass", "hourglass", "wheel", "tire", "gears", "chain", "fishing rod", "sewing machine", "typewriter",
];

const VEHICLES = [
  "car", "bus", "truck", "motorcycle", "bicycle", "scooter", "train", "tram", "subway train", "airplane",
  "helicopter", "hot air balloon", "rocket", "sailboat", "motorboat", "canoe", "kayak", "cruise ship", "ferry", "submarine",
  "tractor", "fire truck", "ambulance", "taxi", "police car", "school bus", "race car", "cable car", "horse carriage", "wagon",
];

const BUILDINGS_AND_PLACES = [
  "house", "cottage", "log cabin", "barn", "farmhouse", "apartment building", "skyscraper", "office building", "church", "cathedral",
  "mosque", "temple", "pagoda", "castle", "palace", "fort", "tower", "clock tower", "lighthouse", "windmill",
  "wind turbine", "water tower", "bridge", "suspension bridge", "arch bridge", "aqueduct", "dam", "tunnel", "pier", "harbor",
  "train station", "airport", "stadium", "gas station", "greenhouse", "factory", "smokestack", "pyramid", "ruins", "gazebo",
  "igloo", "treehouse", "statue", "dome", "archway", "city skyline", "street", "alley", "parking lot", "playground",
  "garden", "park", "farm field", "swimming pool", "library", "museum", "market", "shopping mall", "university campus", "courtyard",
];

const FAMOUS_LANDMARKS = [
  "Eiffel Tower", "Statue of Liberty", "Big Ben", "Tower Bridge", "London Eye", "Colosseum", "Leaning Tower of Pisa", "Taj Mahal", "Great Wall of China", "Sydney Opera House",
  "Christ the Redeemer", "Machu Picchu", "Great Pyramid of Giza", "Great Sphinx", "Stonehenge", "Mount Rushmore", "Empire State Building", "Brooklyn Bridge", "Space Needle", "Gateway Arch",
  "Lincoln Memorial", "White House", "United States Capitol", "Golden Gate Bridge", "Alcatraz Island", "Grand Canyon", "Niagara Falls", "Mount Fuji", "Mount Everest", "Burj Khalifa",
  "Petronas Towers", "Sagrada Familia", "Notre-Dame de Paris", "Arc de Triomphe", "Louvre Pyramid", "Brandenburg Gate", "Neuschwanstein Castle", "Parthenon", "Saint Basil's Cathedral", "Angkor Wat",
  "Petra", "Chichen Itza", "Moai statues", "Forbidden City", "Tokyo Tower", "CN Tower", "Sydney Harbour Bridge", "Hagia Sophia", "Alhambra", "Buckingham Palace",
  "Tower of London", "Westminster Abbey", "Matterhorn", "Uluru", "Victoria Falls", "Half Dome", "Hoover Dam", "Times Square", "Flatiron Building", "Chrysler Building",
];

/** Every generic label, about 600, each once. */
export const GENERIC_LABELS: readonly string[] = [
  ...TEXTURES_AND_SCENERY,
  ...ANIMALS,
  ...FOOD_AND_DRINK,
  ...PLANTS,
  ...OBJECTS,
  ...VEHICLES,
  ...BUILDINGS_AND_PLACES,
  ...FAMOUS_LANDMARKS,
];
