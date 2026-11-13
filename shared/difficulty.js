// How hard each question is for an average adult player: 0 is something almost everyone gets
// right, 10 is something very few people know. Judged by hand from the picture or question
// and its four wrong options, not from players' answers.
//
// Listed by topic as "id:rating" pairs. An id can leave out its topic prefix ("axolotl" for
// "animals-axolotl"). `npm run validate` checks that every question has exactly one rating.
//
// Used to build the Daily Challenge and duels from easy to hard; it doesn't change points.

export const DIFFICULTY = {
  flags: `
    flag-br:1 flag-ca:1 flag-jp:0 flag-kr:3 flag-de:2 flag-be:4 flag-it:2 flag-ie:4 flag-ci:6 flag-ro:6
    flag-td:7 flag-id:5 flag-mc:7 flag-pl:5 flag-nl:4 flag-lu:7 flag-ru:3 flag-se:2 flag-no:4 flag-is:6
    flag-fi:3 flag-dk:3 flag-ch:2 flag-gr:3 flag-ar:3 flag-mx:2 flag-in:2 flag-ne:7 flag-za:4 flag-ke:5
    flag-au:4 flag-nz:6 flag-tr:2 flag-tn:6 flag-vn:4 flag-np:4 flag-bt:7 flag-lk:7 flag-co:5 flag-ec:7
    flag-us:0 flag-gb:0 flag-fr:0 flag-es:1 flag-pt:2 flag-cn:0 flag-il:0 flag-eg:3 flag-sa:2
    flag-ae:4 flag-jo:5 flag-lb:1 flag-sy:5 flag-iq:5 flag-ir:4 flag-pk:3 flag-bd:4 flag-th:3
    flag-my:5 flag-sg:6 flag-ph:4 flag-kz:6 flag-ua:1 flag-at:2 flag-hu:4 flag-bg:5 flag-hr:4
    flag-rs:6 flag-cz:4 flag-sk:7 flag-si:8 flag-ee:7 flag-lv:7 flag-lt:7 flag-al:5 flag-cu:3
    flag-cl:3 flag-pe:3 flag-ve:5 flag-uy:5 flag-py:7 flag-bo:6 flag-jm:2 flag-ng:3 flag-et:6
    flag-gh:5 flag-sn:7 flag-ml:7 flag-gn:8 flag-cm:7 flag-ma:2 flag-dz:4 flag-cy:3 flag-mt:6
    flag-ge:6 flag-am:6 flag-kp:2 flag-kh:4 flag-mn:6 flag-cr:6`,
  capitals: `
    capital-ca:4 capital-tr:4
    capital-ar:2 capital-eg:1
    capital-in:2 capital-cn:1 capital-jp:0 capital-kr:2 capital-de:1
    capital-pt:2 capital-no:3
    capital-fr:0 capital-gb:0 capital-it:0 capital-es:0 capital-ru:0 capital-us:1 capital-gr:1
    capital-at:2 capital-be:2 capital-nl:2 capital-se:2 capital-dk:2 capital-ie:1
    capital-pl:2 capital-cz:2 capital-hu:2
    capital-ua:1 capital-sa:2 capital-iq:1 capital-ir:1 capital-sy:1 capital-lb:1 capital-jo:1
    capital-kw:2 capital-qa:2 capital-af:2 capital-th:0 capital-id:2 capital-my:2 capital-np:2
    capital-kp:1 capital-mx:0 capital-cu:1 capital-pe:1 capital-cl:1 capital-ve:2 capital-tn:1
    capital-dz:1 capital-ly:2`,
  seas: `
    sea-mediterranean:2 sea-red:3
    sea-dead:3 sea-pacific:2 sea-indian:3`,
  signs: `
    sign-stop:0 sign-give-way:1 sign-no-entry:2 sign-no-vehicles:6 sign-no-parking:3 sign-no-stopping:4
    sign-no-u-turn:1 sign-no-left-turn:1 sign-speed-50:0 sign-end-speed:4 sign-min-speed:6 sign-roundabout:2
    sign-keep-right:2 sign-one-way:3 sign-dead-end:4 sign-priority:5 sign-end-priority:6 sign-signals:2
    sign-two-way:4 sign-crossroads:3 sign-il-101:4 sign-il-102:2 sign-il-103:2 sign-il-106:3 sign-il-109:3
    sign-il-114:3 sign-il-117:3 sign-il-121:3 sign-il-127b:6 sign-il-128:5 sign-il-129a:4 sign-il-135:2
    sign-il-137:2 sign-il-138:4 sign-il-139:4 sign-il-140:4 sign-il-141:3 sign-il-142:3 sign-il-144:3
    sign-il-146b:2 sign-il-147:4 sign-il-151:6 sign-il-152a:6 sign-il-203:2 sign-il-208:3 sign-il-215:2
    sign-il-216:4 sign-il-217:5 sign-il-220:5 sign-il-222:4 sign-il-228:4 sign-il-302:0 sign-il-304:7
    sign-il-306:2 sign-il-307:6 sign-il-308:6 sign-il-401:6 sign-il-407:6 sign-il-409:3 sign-il-411:3
    sign-il-412:2 sign-il-413:2 sign-il-415:5 sign-il-416:5 sign-il-418:6 sign-il-420:4 sign-il-426a:3
    sign-il-637:6 sign-il-639:4 sign-il-901:2
    sign-il-115:3 sign-il-116:3 sign-il-133:6 sign-il-134:7 sign-il-136:1 sign-il-145:2
    sign-il-146a:0 sign-il-150:2 sign-il-153:5 sign-il-201:1 sign-il-202:1 sign-il-204:1
    sign-il-205:1 sign-il-206:2 sign-il-207:2 sign-il-212:3 sign-il-213:5 sign-il-218:4
    sign-il-219:5 sign-il-224:2 sign-il-225:3 sign-il-226:1 sign-il-227:1 sign-il-221:6
    sign-il-223:3 sign-il-405:4 sign-il-410:1 sign-il-421:5 sign-il-422:6 sign-il-428:0`,
  animals: `
    axolotl:5 okapi:7 red-panda:3 snow-leopard:4 platypus:3 capybara:4 quokka:6 fennec:5 aye-aye:8 tarsier:7
    komodo:4 pangolin:6 aardvark:6 wombat:6 kakapo:9 shoebill:7 secretarybird:8 mandrill:6 proboscis:5
    manatee:5 blobfish:6 toucan:1 mantis-shrimp:7 sloth:1 meerkat:2
    lion:0 tiger:0 leopard:2 cheetah:2 jaguar:3 elephant:0 giraffe:0 zebra:0 hippopotamus:0
    rhinoceros:0 gorilla:0 chimpanzee:1 orangutan:1 kangaroo:0 koala:0 giant-panda:0 polar-bear:0
    brown-bear:0 wolf:1 red-fox:1 camel:0 horse:0 donkey:0 cow:0 pig:0 sheep:0 goat:0 rabbit:0
    squirrel:0 hedgehog:0 deer:0 moose:2 penguin:0 owl:0 bald-eagle:1 flamingo:0 peacock:0 macaw:2
    swan:0 duck:0 ostrich:1 dolphin:0 humpback-whale:1 great-white-shark:0 orca:2 octopus:0
    jellyfish:0 seahorse:0 crab:0 lobster:1 starfish:0 crocodile:0 sea-turtle:0 tortoise:1
    chameleon:0 frog:0 cobra:2 monarch-butterfly:1 honey-bee:1 ladybird:0 hyena:3 warthog:4
    ring-tailed-lemur:4 raccoon:2 skunk:3 otter:3 walrus:2 beaver:3 armadillo:4 llama:3 alpaca:4
    bison:3 puffin:4 pelican:3 narwhal:7`,
  cars: `
    beetle:1 2cv:6 mini:2 mustang:3 911:4 countach:6 delorean:5 wrangler:3 defender:4 model-3:3 prius:4
    fiat-500:3 g-class:4 veyron:6 type-2:4 golf:4 model-t:4 mx-5:6 f40:7 e-type:7 fortwo:2 gt-r:6
    range-rover:4 corvette:5 aventador:5
    toyota-corolla:1 toyota-camry:2 toyota-rav4:2 toyota-land-cruiser:2 toyota-hilux:2 honda-civic:1
    honda-accord:2 honda-cr-v:3 ford-f-150:1 ford-focus:2 ford-fiesta:2 ford-transit:2 ford-gt:3
    chevrolet-camaro:1 dodge-challenger:2 dodge-viper:2 cadillac-escalade:1 humvee:0 ford-bronco:3
    tesla-model-s:1 tesla-model-x:1 tesla-model-y:2 tesla-cybertruck:0 bmw-3-series:2 bmw-x5:3
    bmw-i8:2 bmw-isetta:3 mercedes-benz-s-class:2 mercedes-benz-300-sl:2 audi-tt:2 audi-r8:2
    porsche-cayenne:2 porsche-taycan:3 volkswagen-passat:3 volkswagen-polo:2 volkswagen-tiguan:3
    renault-clio:3 renault-twingo:4 peugeot-205:4 citroen-ds:3 fiat-multipla:4 fiat-panda:3
    ferrari-testarossa:1 ferrari-laferrari:2 ferrari-enzo:3 ferrari-250-gto:3 lamborghini-urus:1
    lamborghini-huracan:2 lamborghini-miura:3 lamborghini-diablo:2 mclaren-f1:3 mclaren-p1:3
    bugatti-chiron:2 aston-martin-db5:1 rolls-royce-phantom:0 bentley-continental-gt:2 lotus-elise:3
    subaru-impreza:2 mitsubishi-lancer-evolution:2 nissan-leaf:2 toyota-supra:1 honda-nsx:3
    mazda-rx-7:3 trabant:2 lada-riva:3 reliant-robin:3 hindustan-ambassador:5 austin-fx4:2
    chrysler-pt-cruiser:2 pontiac-firebird:2 dodge-charger:1 volvo-240:4 saab-900:5
    hummer-h2:1`,
  code: `
    python:4 javascript:4 rust:8 go:7 c:6 ruby:7 sql:4 haskell:9 php:6 swift:7 kotlin:8 java:5 csharp:6
    lua:8 bash:6 elixir:9 clojure:9 r:7 typescript:6 prolog:9`,
  landmarks: `
    petra:3 machu-picchu:3 taj-mahal:1 angkor-wat:4 colosseum:1 sagrada:4 neuschwanstein:5 moai:3
    stonehenge:2 christ-redeemer:1 golden-gate:1 sydney-opera:1 burj-khalifa:1 great-wall:0 chichen-itza:4
    eiffel:0 pisa:0 mont-saint-michel:5 hagia-sophia:5 alhambra:6 forbidden-city:5 potala:7 giza:0
    rushmore:2 liberty:0
    big-ben:0 tower-bridge:0 buckingham-palace:1 arc-de-triomphe:0 notre-dame-de-paris:0
    louvre-pyramid:0 palace-of-versailles:1 brandenburg-gate:1 cologne-cathedral:5 trevi-fountain:1
    st-peter-s-basilica:1 rialto-bridge:5 milan-cathedral:5 pantheon-rome:2 parthenon:0
    blue-mosque:1 western-wall:0 dome-of-the-rock:0 masada:1 burj-al-arab:0
    sheikh-zayed-grand-mosque:4 empire-state-building:1 white-house:0 united-states-capitol:1
    niagara-falls:0 grand-canyon:0 cn-tower:4 space-needle:4 gateway-arch:5 teotihuacan:6
    iguazu-falls:4 uluru:4 sydney-harbour-bridge:4 great-sphinx-of-giza:0 abu-simbel:5 karnak:6
    victoria-falls:4 table-mountain:5 moscow-kremlin:4 saint-basil-s-cathedral:0 winter-palace:7
    charles-bridge:5 prague-astronomical-clock:5 atomium:5 the-little-mermaid:2 matterhorn:2
    mount-fuji:0 tokyo-tower:1 himeji-castle:6 kinkaku-ji:6 fushimi-inari-taisha:5
    temple-of-heaven:7 terracotta-army:1 marina-bay-sands:1 taipei-101:5
    borobudur:6 bagan:8 golden-temple:4 gateway-of-india:5 red-fort:6 hawa-mahal:7
    shwedagon-pagoda:7 wat-arun:6 meteora:7 edinburgh-castle:5 windsor-castle:5 bran-castle:7
    giant-s-causeway:6 guggenheim-museum-bilbao:6 park-guell:5 brooklyn-bridge:1 chrysler-building:5
    lincoln-memorial:4 hoover-dam:5`,
  dogs: `
    labrador:3 golden:3 german-shepherd:2 french-bulldog:3 bulldog:3 beagle:3 poodle:2
    dachshund:2 husky:2 pug:1
    chihuahua:1 dalmatian:0
    st-bernard:3
    maltese:2 jack-russell-terrier:1 american-pit-bull-terrier:1 english-mastiff:2 rough-collie:1
    chow-chow:1 shar-pei:1 pekingese:2 boston-terrier:2
    miniature-schnauzer:2 bichon-frise:2 west-highland-white-terrier:2 scottish-terrier:2
    goldendoodle:2 old-english-sheepdog:2
    shetland-sheepdog:2
    canaan-dog:2`,
  food: `
    sushi:0 paella:3 pho:5 ramen:3 tacos:1 croissant:0 pretzel:1 falafel:1 hummus:1 shakshouka:2 biryani:5
    pad-thai:4 peking-duck:4 bibimbap:6 kimchi:5 moussaka:6 goulash:6 pierogi:6 borscht:5 poutine:6
    fish-chips:1 tiramisu:3 baklava:2 churros:3 lasagne:2 risotto:4 ratatouille:5
    fondue:3 schnitzel:2 couscous:3 tagine:5 samosa:3
    pastel-de-nata:6
    pizza:0 hamburger:0 hot-dog:0 spaghetti:0 french-fries:0 pancakes:0 waffles:0 doughnut:0 bagel:0
    omelette:0 steak:0 caesar-salad:1 greek-salad:1 burrito:0 nachos:0 guacamole:0 dumplings:1
    spring-rolls:0 fried-rice:0 butter-chicken:2 naan:1 shawarma:0 pita:0 tabbouleh:2 kibbeh:2
    knafeh:1 halva:1 sufganiyah:0 challah:0 borek:2 cheesecake:0 apple-pie:0 brownie:0 ice-cream:0
    macaron:1 creme-brulee:2 eclair:2 mochi:2 tempura:2 satay:3 tom-yum:3 gazpacho:3 minestrone:3
    sauerkraut:2 empanada:2 enchilada:2 bruschetta:2 ravioli:1 gnocchi:3 macaroni-and-cheese:0
    carbonara:2 gyros:1 pumpkin-pie:2 bratwurst:2 scrambled-eggs:0 nasi-goreng:4 rendang:5
    jambalaya:4 haggis:5 tamale:5`,
  countries: `
    country-380:0 country-152:2 country-392:2 country-356:3 country-076:4 country-036:1 country-484:4
    country-724:3 country-620:5 country-300:4 country-792:4 country-818:4 country-710:5 country-450:4
    country-826:3 country-372:6 country-352:6 country-276:5 country-616:7 country-804:6 country-752:6
    country-246:6 country-704:4 country-764:5 country-032:4 country-604:7 country-682:5 country-364:7
    country-156:4 country-496:7 country-398:7 country-124:4 country-643:3 country-706:5 country-566:8
    country-554:4 country-192:4 country-608:6 country-191:6 country-376:1
    country-840:1 country-250:1 country-860:7 country-428:7 country-528:4 country-056:5
    country-208:5 country-578:2 country-040:5 country-756:5 country-348:6 country-642:6
    country-100:6 country-688:7 country-203:6 country-703:7 country-112:6 country-008:7
    country-196:4 country-268:7 country-368:4 country-760:4 country-400:5 country-422:3
    country-414:7 country-634:6 country-784:6 country-512:6 country-887:5 country-004:5
    country-586:4 country-050:7 country-144:2 country-524:5 country-104:6 country-418:7
    country-116:6 country-458:6 country-360:3 country-408:3 country-410:3 country-158:2
    country-012:4 country-504:4 country-788:5 country-434:4 country-729:5 country-231:5
    country-404:5 country-834:6 country-508:5 country-024:6 country-894:7 country-516:6
    country-068:6 country-600:6 country-858:6 country-862:5 country-170:5 country-218:6`,
  elements: `
    element-h:1 element-he:2 element-li:4 element-c:2 element-n:3 element-o:1 element-f:5 element-ne:4
    element-na:6 element-mg:4 element-al:4 element-si:5 element-p:5 element-s:5 element-cl:4 element-ar:5
    element-k:7 element-ca:4 element-ti:5 element-cr:6 element-mn:7 element-fe:5 element-co:5 element-ni:5
    element-cu:6 element-zn:5 element-kr:6 element-ag:6 element-sn:8 element-sb:9 element-xe:6 element-w:8
    element-pt:5 element-au:5 element-hg:7 element-pb:7 element-rn:6 element-ra:6 element-u:4 element-pu:5`,
  music: `
    violin:1 cello:3 double-bass:4 harp:1 ukulele:3 banjo:3 mandolin:5 sitar:5 oud:4 balalaika:5 bouzouki:7
    erhu:8 koto:8 shamisen:8 accordion:1 harmonica:2 bagpipes:1 flute:1 clarinet:4 oboe:7 bassoon:7
    saxophone:1 trumpet:1 trombone:3 french-horn:4 tuba:3 didgeridoo:4 pan-flute:4 ocarina:6 xylophone:2
    steelpan:6 djembe:5 tabla:6 timpani:6 cajon:7 theremin:9 harpsichord:6 pipe-organ:3 handpan:7
    tambourine:1
    piano:0 guitar:0 electric-guitar:0 bass-guitar:1 drum-kit:0 snare-drum:1 bass-drum:2 cymbal:1
    triangle:0 maracas:0 castanets:1 recorder:0 piccolo:2 viola:3 gong:0 synthesizer:1 bongo-drums:1
    congas:2 darbuka:1 shofar:0 lyre:2 lute:3 marimba:3 glockenspiel:3 bugle:2 kazoo:2 vuvuzela:1
    sleigh-bells:1 cowbell:1 alphorn:2 keytar:2 melodica:3 cornet:3 sousaphone:3 ney:2 qanun:2 riq:3
    hand-bell:1 whistle:0 electric-violin:2 kalimba:4 kora:5 zither:4 lap-steel-guitar:5 euphonium:5
    vibraphone:5 tubular-bells:4 concertina:4 bandoneon:5 english-horn:6 saz:5 santur:6 duduk:6
    hurdy-gurdy:7 rebab:7 angklung:8 guzheng:7 clavichord:8 celesta:7 serpent:9`,
  sapiens: `
    cognitive-power:5 fraud:5 wheat:4 imagined-order:6 gossip-limit:6 three-revolutions:4 money-trust:5
    ignorance:6 other-humans:3 disappeared:6 foragers:5 unifiers:7 writing:6 feedback-loop:7 credit:6
    domestic-animals:5 universal-religion:5 megafauna:6 happiness:5 hammurabi:6 hammurabi-why:7
    luxury-trap:5 empire-science:6 future:4 peugeot:8 gossip:5 origin:4 population:5 religion-def:7
    brain-size:7`,
  habits: `
    one-percent:4 four-laws:5 four-stages:6 plateau:6 systems:5 identity:5 stacking:4 implementation:6
    two-minute:3 bundling:5 invisible:4 break-laws:5 commitment-device:6 never-twice:4 brailsford:8
    environment:4 tracking:4 goldilocks:6 dopamine:6 easy:3 repetitions:6 paper-clips:6 culture:4
    decisive-moments:6 cardinal-rule:5 motion-action:7 boredom:6 downside:7 prime:5 author:2`,
  sayno: `
    why-hard:4 assertive:4 excuses:4 lies:4 alternative:3 vague:4 every-yes:4 respect:3 disappointment:5
    fomo:3 boss:5 family:5 friends:4 to-yourself:5 i-dont:6 start-small:4 muscle:3 less-later:6
    self-first:3 softer:4 ownership:6 persistent:4 refer:4 limits:5 responsibility:6 go-to:5 reasons:7
    aim:6 author:3 cost:3`,
  paintings: `
    mona-lisa:0 starry-night:1 last-supper:1 scream:1 pearl-earring:3 venus:3 night-watch:6 las-meninas:7
    earthly-delights:7 great-wave:3 kiss:4 impression:6 sunflowers:3 creation-adam:2 school-athens:6
    liberty:5 medusa:8 wanderer:6 arnolfini:8 whistler:7 third-may:7 cafe-terrace:6 moulin:8 swing:8
    ermine:7 primavera:7 olympia:8 boating-party:8 american-gothic:4 nighthawks:6
    water-lilies:1 irises:2 the-potato-eaters:4 bedroom-in-arles:2 wheatfield-with-crows:3
    almond-blossoms:3 the-night-cafe:4 poppies:4 woman-with-a-parasol:3 the-japanese-footbridge:4
    la-grande-jatte:2 a-bar-at-the-folies-bergere:4 le-dejeuner-sur-l-herbe:3 the-card-players:4
    l-absinthe:6 the-ballet-class:4 dance-at-bougival:6 paris-street-rainy-day:5
    portrait-of-adele-bloch-bauer-i:3 fine-wind-clear-morning:5 the-fighting-temeraire:4
    rain-steam-and-speed:5 the-hay-wain:4 saturn-devouring-his-son:2 the-nude-maja:4 rokeby-venus:6
    venus-of-urbino:6 the-anatomy-lesson:4 the-prodigal-son:5 the-storm-on-galilee:4 the-milkmaid:3
    the-art-of-painting:6 the-calling-of-saint-matthew:6 judith-beheading-holofernes:4
    sistine-madonna:5 vitruvian-man:0 the-last-judgment:3 the-tower-of-babel:2 hunters-in-the-snow:3
    ghent-altarpiece:7 the-ambassadors:5 the-death-of-marat:3 napoleon-crossing-the-alps:0
    grande-odalisque:5 the-gleaners:3 the-angelus:5 the-desperate-man:5
    self-portrait-with-bandaged-ear:1 barge-haulers-on-the-volga:6 the-lady-of-shalott:3 ophelia:3
    madame-x:5 composition-vii:6 black-square:2 composition-in-red-blue-yellow:2 dance:4
    the-sleeping-gypsy:4 tiger-in-a-tropical-storm:3 vertumnus:2 the-blue-boy:3 mr-and-mrs-andrews:7
    the-laughing-cavalier:4 two-sisters:7 the-slave-ship:6 the-bathers-at-asnieres:7
    plum-park-in-kameido:7 the-supper-at-emmaus:7 the-lacemaker:7 the-tree-of-life:5
    portrait-of-dr-gachet:5`,
  body: `
    pectoralis:4 fibula:6 quadriceps:4 heart:1 large-intestine:3 femur:4 humerus:6
    tibia:5 sternum:6 mandible:5 clavicle:5 rib-cage:1 pelvis:3 navel:0 knee:0 ear:0 radius:7
    nose:0 eye:0 mouth:0 eyebrow:0 hand:0 foot:0 thumb:0 toe:0 shoulder:0 wrist:1 tooth:0 tongue:0
    lips:0 brain:0 lungs:0 neck:0 cheek:0
    pump-blood:0 breathe:0 think:0 biggest-organ:2 longest-bone:2 smallest-bone:3 senses:0
    adult-teeth:2 blood-colour:3 filter-blood:1 insulin:3 bile:4 food-absorb:4 kneecap:4
    shoulder-blade:5 strongest-muscle:4 achilles:4 oxygen-carrier:2 fight-infection:2 clot:4
    blood-type-universal:4 dna-shape:3 chromosomes:5 body-water:3 heart-chambers:2 ribs:4
    vertebrae:6 biggest-artery:5 windpipe:5 voice-box:5 food-pipe:4 eye-colour:2 pupil:2 retina:5
    skin-colour:3 hair-protein:4 balance:4 muscle-count:5 baby-bones:5 fastest-growing:3
    largest-gland:5 neck-gland:5 stress-hormone:6 vitamin-sun:1 vitamin-c:3 brain-parts:7
    memory-part:7 tendon-bone:3 ligament:4 nose-tip:3 funny-bone:4 stapes:7 tailbone:7 jaw-muscle:8
    longest-muscle:9 appendix:4 urine:1 blood-volume:3 heart-rate:3 lung-lobes:5 protect-brain:0
    spinal-cord:1 stomach-acid:1 liver-alcohol:2 bend-elbow:2 bean-organ:1`,
  people: `
    einstein:0 obama:1 taylor-swift:2 ronaldo:1 messi:1 musk:2 oprah:4 michael-jackson:1 monroe:2
    elizabeth:2 steve-jobs:2 gates:3 beyonce:3 dicaprio:3 rihanna:3 hawking:3 chaplin:2 mlk:4 frida:5 ali:4
    nelson-mandela:0 mahatma-gandhi:0 abraham-lincoln:0 george-washington:1 donald-trump:0
    joe-biden:0 vladimir-putin:0 volodymyr-zelenskyy:0 angela-merkel:1 winston-churchill:1
    john-f-kennedy:1 pope-francis:1 mother-teresa:1 diana-princess-of-wales:1 marie-curie:2
    nikola-tesla:2 charles-darwin:1 mark-zuckerberg:0 jeff-bezos:1 warren-buffett:2 brad-pitt:0
    angelina-jolie:0 tom-cruise:0 will-smith:0 johnny-depp:0 tom-hanks:1 morgan-freeman:0
    robert-de-niro:1 arnold-schwarzenegger:0 sylvester-stallone:0 dwayne-johnson:0 jackie-chan:0
    bruce-lee:0 keanu-reeves:1 scarlett-johansson:1 jennifer-aniston:1 jennifer-lopez:0
    emma-watson:1 audrey-hepburn:2 gal-gadot:0 elvis-presley:0 john-lennon:0 paul-mccartney:1
    freddie-mercury:0 david-bowie:1 bob-marley:0 madonna:0 lady-gaga:0 shakira:0 adele:0
    ed-sheeran:0 justin-bieber:0 ariana-grande:0 billie-eilish:1 eminem:0 snoop-dogg:1
    michael-jordan:0 lebron-james:0 kobe-bryant:1 serena-williams:0 roger-federer:0 rafael-nadal:0
    novak-djokovic:1 usain-bolt:0 tiger-woods:0 mike-tyson:0 pablo-picasso:2 salvador-dali:1
    walt-disney:2 yitzhak-rabin:3 golda-meir:2 david-ben-gurion:2 benjamin-netanyahu:0
    yasser-arafat:1 theodor-herzl:3 neil-armstrong:4 yuri-gagarin:5 malala-yousafzai:4
    ernest-hemingway:5 greta-thunberg:3`,
  beauty: `
    lipstick:0 mascara:2 eyeliner:3 eye-shadow:3 face-powder:4 eyelash-curler:4
    makeup-brushes:2 hair-dryer:0 bobby-pin:3 lip-gloss:3 eyebrow-pencil:4 eyelash-extensions:4
    makeup-sponge:4 tweezers:2 nail-file:3 hair-straightener:2 curling-iron:3
    perfume:0 loofah:4
    bath-bombs:4 epilator:6 foundation:5 henna:4 artificial-nails:4
    cotton-pads:3 pumice-stone:5 blush:5
    bronzer:7 concealer:6 lip-liner:6 powder-puff:5 powder-compact:5 makeup-bag:2
    liquid-eyeliner:5
    lip-balm:0 shampoo:0 hair-conditioner:1 hair-gel:1 hair-spray:1 hair-dye:1
    deodorant:0 soap:0 body-lotion:1
    straight-razor:1 false-eyelashes:0 face-mask:0 gua-sha:4
    bath-salts:1 essential-oil:2 kohl:3 gel-nails:3
    tanning-bed:1
    castor-oil:5 rosewater:4 argan-oil:4 shea-butter:3 mouthwash:1
    microblading:5 hand-cream:1
    shower-cap:0 toothpaste:0 dental-floss:0 wig:0 hand-sanitizer:0
    nail-art:1 glitter:1 sindoor:6 pedicure:1 nail-scissors:1`,
  jobs: `
    firefighter:0 surgeon:1 astronaut:0 barber:1 dentist:1 beekeeper:1 lifeguard:2 welder:2 baker:1
    jockey:3 farrier:7 glassblower:4 sommelier:5 luthier:8 chimney-sweep:4 stonemason:5 watchmaker:4
    falconer:4 cobbler:5 air-traffic-controller:5
    chef:0 police-officer:0 airline-pilot:0 nurse:0 teacher:0 farmer:0 fisherman:0 carpenter:0
    electrician:1 plumber:1 auto-mechanic:0 photographer:0 waiter:0 soldier:0 judge:1
    construction-worker:0 coal-miner:1 tailor:2 hairdresser:0 butcher:0 veterinarian:1 librarian:1
    postman:1 flight-attendant:1 blacksmith:2 potter:2 shepherd:2 gardener:1 archaeologist:3
    sculptor:3`,
  logos: `
    nike:0 mercedes:1 audi:2 mitsubishi:4 twitter:1 instagram:0 spotify:2
    target:4 youtube:0 volkswagen:1 microsoft:1 chrome:1 telegram:2 facebook:0
    dropbox:5 subaru:6 citroen:5 hyundai:4 renault:4 chevrolet:3 shell:2 jordan:4 slack:6 twitch:5 opera:6
    apple:0 mcdonald-s:0 starbucks:0 tesla:1 infiniti:7 whatsapp:0 snapchat:0 tiktok:0 pinterest:1
    linkedin:1 skype:2 viber:5 wechat:6 windows:0 android:0 firefox:1 google:0 gmail:1 google-maps:1
    google-drive:2 amazon:1 netflix:0 playstation:0 xbox:1 steam:5 adobe-photoshop:2
    adobe-illustrator:5 paypal:1 bitcoin:0 ethereum:5 airbnb:2 soundcloud:3 vimeo:7 microsoft-edge:2
    internet-explorer:1 linux:2 github:3 tumblr:5 wordpress:4 threads:5 facebook-messenger:1 x:0
    bluetooth:1 google-photos:5 google-play:1 youtube-music:3 apple-music:2 google-translate:3
    microsoft-word:0 microsoft-excel:0 microsoft-powerpoint:0 microsoft-outlook:2 microsoft-teams:2
    onedrive:5 vlc:2 blender:7 figma:6 notion:7 shazam:3 google-calendar:2 google-docs:2
    google-sheets:2 app-store:1 chatgpt:1 uber:2 google-meet:3 google-keep:6 google-slides:3
    google-earth:4 onenote:5 icloud:3 apple-podcasts:4 acura:7 adobe-premiere-pro:4
    adobe-after-effects:6`,
  clubs: `
    real-madrid:3 barcelona:2 atletico:5 sevilla:7 juventus:4 inter:6 napoli:6 marseille:7 ajax:6
    galatasaray:6 boca:7 river-plate:8 flamengo:8 santos:8 al-hilal:7 porto:7 benfica:7 milan:5 dortmund:4
    sporting:8 man-utd:3 man-city:4 liverpool:4 chelsea:4 arsenal:3 newcastle:7 aston-villa:8 west-ham:7
    tottenham:5 bayern:4 roma:6 psg:4 celtic:7 rangers:8 maccabi-tel-aviv:5 maccabi-haifa:6 beitar:6
    inter-miami:5 zamalek:6 al-ahly:5`,
  footballers: `
    mbappe:3 haaland:4 neymar:2 salah:2 modric:5 lewandowski:5 de-bruyne:5 kane:5 vinicius:5 bellingham:6
    zlatan:4 pele:4 maradona:4 zidane:4 ronaldinho:3 beckham:2 henry:6 kaka:6 iniesta:6 buffon:6 ramos:5
    pirlo:7 rooney:5 griezmann:6 pogba:5 van-dijk:6 son:6 yamal:5 cruyff:8 beckenbauer:8
    ronaldo-nazario:5 maldini:7 robben:7 drogba:6 neuer:7 mahrez:6 hakimi:6 mane:6 bale:6 pedri:8`,
  currencies: `
    usd:1 eur:2 gbp:3 jpy:5 chf:6 inr:4 rub:6 ils:1 try:4 cad:5 aud:5 brl:6 mxn:6 egp:4 krw:6 mad:6 jod:4
    thb:6 sar:4 cny:4`,
  guns: `
    ak-47:1 m16:2 uzi:1 desert-eagle:2 glock:2 tommy-gun:2 rpg-7:2 minigun:2 musket:2 gatling:2
    bazooka:1 flare-gun:3 revolver:0 taser:1 double-barrel:2 m4:3 m1911:3 mp5:3
    p90:3 barrett:3 luger:3 peacemaker:3 shotgun:2 m1-garand:3 mp40:3 tavor:3 paintball:2 sniper-rifle:1
    winchester:3 flintlock-pistol:2 blunderbuss:3 m79:2 sawed-off:2 derringer:3 walther-ppk:3 m60:3
    hand-cannon:3 colt-python:3 beretta-92:4 spas-12:5 steyr-aug:5 galil:5 dragunov:5 mosin-nagant:6
    kar98k:5 ppsh-41:5 mac-10:4 m249:5`,
  history: `
    balfour:6 partition:5 israel-independence:2 nakba:3 six-day:3 yom-kippur:4 camp-david:3 intifada:6
    oslo:4 syria-war:5 assad:2 palmyra:6 sykes-picot:5 lebanon-war:7 taif:7 beirut-blast:4 hariri:5
    franz-ferdinand:4 wwi-end:4 versailles:4 somme:6 gallipoli:5 lusitania:6 wwii-start:3 pearl-harbor:4
    d-day:2 nagasaki:2 stalingrad:5 churchill:1 yalta:5 enigma:4 bastille:3 salt-march:3
    moon:1 cuba:3 berlin-wall:4 mandela:2 chernobyl:4 arab-spring:4
    wwi-start:0 princip:4 trenches:0 us-enters-wwi:3 ypres-gas:3 first-tanks:6 verdun:4
    brest-litovsk:5 kaiser:4 red-baron:3 ottoman-end:2 lawrence:3 poppy:1 christmas-truce:2
    zimmermann:6 league:2 beersheba:5 allenby:5 wwii-end:0 axis:1 hitler-chancellor:3 mussolini:1
    dunkirk:2 blitz:2 barbarossa:3 anne-frank:1 auschwitz:1 auschwitz-freed:3 enola-gay:3
    manhattan:2 desert-fox:3 el-alamein:4 warsaw-ghetto:3 nuremberg:2 schindler:1 wallenberg:5
    wannsee:5 de-gaulle:2 truman:3 leningrad:4 judenstaat:2 basel:4 mandate:1 arab-revolt-1936:6
    white-paper:6 resolution-181:5 ben-gurion-first:1 weizmann:3 west-bank-1949:3 gaza-1949:3
    golan:2 resolution-242:6 plo-founded:5 yom-kippur-year:1 sadat-visit:2 oslo-handshake:2
    jordan-peace:2 second-intifada:3 gaza-withdrawal:3 october-7:0`,
  trivia: `
    richest-2025:1 richest-ever:6 tallest-building:1 happiest:4 most-people:3 largest-country:1
    smallest-country:2 deepest:5 everest:5 native-speakers:3 tourists:5 bones:4 hottest-planet:6 octopus:5
    honey:4 salvator-mundi:4 largest-desert:7 eiffel-summer:3 shortest-war:7 oldest-person:8
    time-zones:9 flamingo:3 great-wall:4 most-languages:7 lightning:7 driest:6 phelps:2 saturn:6
    lowest-land:3
    tallest-animal:0 blue-whale:1 fastest-land:0 largest-ocean:0 largest-continent:0
    smallest-continent:1 planet-count:0 largest-planet:0 red-planet:0 nearest-star:1 light-speed:3
    boiling-point:0 hardest:0 air-gas:2 gold-symbol:1 world-cups:1 olympic-rings:0 mona-lisa-home:0
    deaf-composer:1 telephone:1 penicillin:2 first-woman-nobel:2 first-in-space:1 largest-island:1
    largest-lake:3 deepest-lake:4 tallest-waterfall:3 highest-seat:6 northern-capital:5 most-lakes:5
    longest-coast:4 double-landlocked:8 no-rivers:6 istanbul-continents:1 coldest-continent:0
    death-valley:4 oldest-university:4 simpsons:2 best-selling-book:1 best-console:4 best-game:3
    titanic-oscars:1 flying-mammal:1 largest-bird:0 smallest-bird:3 longest-vertebrate:7
    largest-eyes:6 no-brain:3 cow-stomach:2 chimp-dna:3 popular-drink:3 expensive-spice:2
    cocoa-producer:5 coffee-producer:2 tallest-statue:5 mauna-kea:6 second-highest:3
    highest-africa:2 trans-siberian:2 gotthard:5 channel-tunnel:0 most-moons:4 venus-day:6
    sun-made-of:3 moon-walkers:5 sunlight-time:3 earth-age:3 great-barrier:0 amazon-share:0
    earth-water:2 dead-sea-float:0`,
  unexpected: `
    polar-bear-skin:7 closest-planet:9 most-pyramids:8 hundred-years-war:6
    deadliest-animal:5
    fortune-cookies:4 danish-pastry:6 caesar-salad:6 hawaiian-pizza:4 croissant-origin:6
    tikka-masala:5 maine-africa:8 reno-west:8 spanish-speakers:2 portuguese-speakers:1
    muslim-population:2 coffee-per-person:4 sun-colour:4 black-box:2 golden-gate-colour:1
    giraffe-tongue:4 centipede-legs:6 lightning-twice:1 bats-blind:1 goldfish-memory:2 bull-red:2
    ostrich-sand:2 brain-use:1 seasons-cause:2 kiwi-egg:6 mammal-eggs:2 man-o-war:7 horned-toad:6
    firefly:5 sea-cucumber:3 slow-worm:7 prairie-dog:3 flying-fox:4 killer-whale:3 horseshoe-crab:7
    tomato:1 cashew:5 vanilla:5 saffron:4 cinnamon:3 bamboo:2 banana-plant:4 water-density:6
    napoleon-height:3 viking-helmets:2 einstein-maths:2 cleopatra-origin:4 cleopatra-time:7
    oxford-aztecs:7 fax-first:7 lighter-first:8 salem:4 medieval-earth:3 pyramid-builders:4
    mars-red:3 danube-source:6 london-north:8 most-countries:3 four-hemispheres:7 polar-hair:3
    backwards-bird:3 sharks-older:6 cats-sweet:4 dogs-colours:4 camel-hump:1 bananas-curve:4
    chameleon-colour:4 lightning-hotter:4 greenland-ice:2 eiffel-temporary:4 first-olympic-prize:6
    sahara-snow:3 frankenstein:2 vader-line:3 mickey-name:6 bubble-wrap:6 play-doh:6 coca-cola:4
    ketchup:6 listerine:7 nintendo-start:5 lamborghini-start:3 samsung-start:6 nokia-start:5
    peugeot-start:7 rolex-founded:7 adidas-puma:4 haagen-dazs:4 toothbrush-bristles:5
    carrots-orange:5 elephant-relative:7 pineapple-grow:4 strawberry-seeds:5 largest-organism:7
    wombat-droppings:4`,
};

/**
 * Sets `difficulty` on every question in `byId` (a Map of id -> question). Returns the problems
 * found: ratings for unknown questions, ratings out of range, and questions given two ratings.
 */
export function applyDifficulty(byId) {
  const problems = [];
  for (const [cat, list] of Object.entries(DIFFICULTY)) {
    for (const pair of list.trim().split(/\s+/)) {
      const [key, value] = pair.split(':');
      const q = [key, `${cat}-${key}`].map((id) => byId.get(id)).find((x) => x?.cat === cat);
      const n = Number(value);
      if (!q) problems.push(`difficulty: no ${cat} question "${key}"`);
      else if (!Number.isInteger(n) || n < 0 || n > 10) problems.push(`difficulty: ${q.id} must be a whole number from 0 to 10`);
      else if (q.difficulty !== undefined) problems.push(`difficulty: ${q.id} is rated twice`);
      else q.difficulty = n;
    }
  }
  return problems;
}
