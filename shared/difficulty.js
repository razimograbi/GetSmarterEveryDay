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
    flag-au:4 flag-nz:6 flag-tr:2 flag-tn:6 flag-vn:4 flag-np:4 flag-bt:7 flag-lk:7 flag-co:5 flag-ec:7`,
  capitals: `
    capital-au:6 capital-ca:4 capital-br:5 capital-tr:4 capital-ch:7 capital-nz:5 capital-ma:6 capital-ng:7
    capital-vn:4 capital-pk:6 capital-kz:7 capital-mm:9 capital-ec:6 capital-co:4 capital-ar:2 capital-eg:1
    capital-ke:4 capital-tz:8 capital-ci:9 capital-in:2 capital-cn:1 capital-jp:0 capital-kr:2 capital-de:1
    capital-pt:2 capital-no:3 capital-is:4 capital-mn:6 capital-ph:3 capital-ae:4`,
  seas: `
    sea-mediterranean:2 sea-black:4 sea-caspian:4 sea-red:3 sea-persian-gulf:4 sea-baltic:5 sea-north:5
    sea-caribbean:4 sea-gulf-of-mexico:4 sea-south-china:5 sea-japan:6 sea-arabian:6 sea-bengal:6 sea-coral:8
    sea-tasman:8 sea-adriatic:5 sea-aegean:6 sea-tyrrhenian:8 sea-bering:7 sea-okhotsk:9 sea-hudson:6
    sea-barents:9 sea-dead:3 sea-pacific:2 sea-indian:3`,
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
    sign-il-637:6 sign-il-639:4 sign-il-901:2`,
  animals: `
    axolotl:5 okapi:7 red-panda:3 snow-leopard:4 platypus:3 capybara:4 quokka:6 fennec:5 aye-aye:8 tarsier:7
    komodo:4 pangolin:6 aardvark:6 wombat:6 kakapo:9 shoebill:7 secretarybird:8 mandrill:6 proboscis:5
    manatee:5 blobfish:6 toucan:1 mantis-shrimp:7 sloth:1 meerkat:2`,
  cars: `
    beetle:1 2cv:6 mini:2 mustang:3 911:4 countach:6 delorean:5 wrangler:3 defender:4 model-3:3 prius:4
    fiat-500:3 g-class:4 veyron:6 type-2:4 golf:4 model-t:4 mx-5:6 f40:7 e-type:7 fortwo:2 gt-r:6
    range-rover:4 corvette:5 aventador:5`,
  code: `
    python:4 javascript:4 rust:8 go:7 c:6 ruby:7 sql:4 haskell:9 php:6 swift:7 kotlin:8 java:5 csharp:6
    lua:8 bash:6 elixir:9 clojure:9 r:7 typescript:6 prolog:9`,
  landmarks: `
    petra:3 machu-picchu:3 taj-mahal:1 angkor-wat:4 colosseum:1 sagrada:4 neuschwanstein:5 moai:3
    stonehenge:2 christ-redeemer:1 golden-gate:1 sydney-opera:1 burj-khalifa:1 great-wall:0 chichen-itza:4
    eiffel:0 pisa:0 mont-saint-michel:5 hagia-sophia:5 alhambra:6 forbidden-city:5 potala:7 giza:0
    rushmore:2 liberty:0`,
  dogs: `
    labrador:3 golden:3 german-shepherd:2 french-bulldog:3 bulldog:3 beagle:3 poodle:2 rottweiler:4
    dachshund:2 yorkshire:4 boxer:5 husky:2 malamute:7 great-dane:5 dobermann:4 shih-tzu:5 pug:1
    chihuahua:1 border-collie:5 aussie:6 corgi:3 shiba:5 akita:6 samoyed:5 dalmatian:0 pomeranian:4
    bernese:5 st-bernard:3 newfoundland:7 bull-terrier:6 greyhound:5 whippet:7 borzoi:8 afghan:6
    weimaraner:7 vizsla:8 basset:4 bloodhound:6 cocker:5 cavalier:7`,
  food: `
    sushi:0 paella:3 pho:5 ramen:3 tacos:1 croissant:0 pretzel:1 falafel:1 hummus:1 shakshouka:2 biryani:5
    pad-thai:4 peking-duck:4 bibimbap:6 kimchi:5 moussaka:6 goulash:6 pierogi:6 borscht:5 poutine:6
    fish-chips:1 ceviche:7 feijoada:8 tiramisu:3 baklava:2 churros:3 lasagne:2 risotto:4 ratatouille:5
    fondue:3 schnitzel:2 couscous:3 tagine:5 jollof:8 injera:7 laksa:8 samosa:3 takoyaki:7 arepa:8
    pastel-de-nata:6`,
  countries: `
    country-380:0 country-152:2 country-392:2 country-356:3 country-076:4 country-036:1 country-484:4
    country-724:3 country-620:5 country-300:4 country-792:4 country-818:4 country-710:5 country-450:4
    country-826:3 country-372:6 country-352:6 country-276:5 country-616:7 country-804:6 country-752:6
    country-246:6 country-704:4 country-764:5 country-032:4 country-604:7 country-682:5 country-364:7
    country-156:4 country-496:7 country-398:7 country-124:4 country-643:3 country-706:5 country-566:8
    country-554:4 country-192:4 country-608:6 country-191:6 country-376:1`,
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
    tambourine:1`,
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
    ermine:7 primavera:7 olympia:8 boating-party:8 american-gothic:4 nighthawks:6`,
  novels: `
    hunger-games:2 deathly-hallows:1 kite-runner:5 book-thief:5 the-help:6 life-of-pi:3 dragon-tattoo:4
    fault-in-our-stars:4 da-vinci-code:2 twilight:1 gone-girl:5 divergent:5 lightning-thief:5
    water-for-elephants:7 lovely-bones:6`,
  body: `
    pectoralis:4 fibula:6 quadriceps:4 nose:0 heart:1 brain:0 large-intestine:3 tongue:0 femur:4 humerus:6
    tibia:5 sternum:6 mandible:5 clavicle:5 rib-cage:1 pelvis:3 navel:0 knee:0 ear:0 radius:7`,
  people: `
    einstein:0 obama:1 taylor-swift:2 ronaldo:1 messi:1 musk:2 oprah:4 michael-jackson:1 monroe:2
    elizabeth:2 steve-jobs:2 gates:3 beyonce:3 dicaprio:3 rihanna:3 hawking:3 chaplin:2 mlk:4 frida:5 ali:4`,
  beauty: `
    lipstick:0 mascara:2 eyeliner:3 nail-polish:1 eye-shadow:3 face-powder:4 eyelash-curler:4
    makeup-brushes:2 hair-dryer:0 bobby-pin:3 lip-gloss:3 eyebrow-pencil:4 eyelash-extensions:4
    makeup-sponge:4 tweezers:2 nail-file:3 nail-clippers:1 hair-straightener:2 curling-iron:3
    hair-rollers:3 claw-clips:4 perfume:0 cotton-swab:1 safety-razor:3 shaving-brush:3 loofah:4
    bath-bombs:4 epilator:6 scrunchies:4 comb:0 foundation:5 henna:4 artificial-nails:4 hairbrush:0
    cotton-pads:3 pumice-stone:5 headband:2 electric-shaver:2 hair-clipper:3 cuticle-nippers:7 blush:5
    bronzer:7 concealer:6 lip-liner:6 powder-puff:5 powder-compact:5 kabuki-brush:8 makeup-bag:2
    liquid-eyeliner:5 vanity-mirror:3`,
  jobs: `
    firefighter:0 surgeon:1 astronaut:0 barber:1 dentist:1 beekeeper:1 lifeguard:2 welder:2 baker:1
    jockey:3 farrier:7 glassblower:4 sommelier:5 luthier:8 chimney-sweep:4 stonemason:5 watchmaker:4
    falconer:4 cobbler:5 air-traffic-controller:5`,
  logos: `
    apple:0 nike:0 mcdonalds:0 mercedes:1 audi:2 mitsubishi:4 twitter:1 instagram:0 whatsapp:0 spotify:2
    target:4 youtube:0 volkswagen:1 microsoft:1 playstation:3 firefox:3 chrome:1 telegram:2 facebook:0
    dropbox:5 subaru:6 citroen:5 hyundai:4 renault:4 chevrolet:3 shell:2 jordan:4 slack:6 twitch:5 opera:6`,
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
  history: `
    balfour:6 partition:5 israel-independence:2 nakba:3 six-day:3 yom-kippur:4 camp-david:3 intifada:6
    oslo:4 syria-war:5 assad:2 palmyra:6 sykes-picot:5 lebanon-war:7 taif:7 beirut-blast:4 hariri:5
    franz-ferdinand:4 wwi-end:4 versailles:4 somme:6 gallipoli:5 lusitania:6 wwii-start:3 pearl-harbor:4
    d-day:2 nagasaki:2 stalingrad:5 churchill:1 holocaust:2 yalta:5 enigma:4 bastille:3 salt-march:3
    moon:1 cuba:3 berlin-wall:4 mandela:2 chernobyl:4 arab-spring:4`,
  trivia: `
    richest-2025:1 richest-ever:6 tallest-building:1 happiest:4 most-people:3 largest-country:1
    smallest-country:2 deepest:5 everest:5 native-speakers:3 tourists:5 bones:4 hottest-planet:6 octopus:5
    honey:4 salvator-mundi:4 largest-desert:7 eiffel-summer:3 banana:7 shortest-war:7 oldest-person:8
    time-zones:9 flamingo:3 great-wall:4 most-languages:7 lightning:7 driest:6 phelps:2 saturn:6
    lowest-land:3`,
  unexpected: `
    polar-bear-skin:7 closest-planet:9 most-pyramids:8 panama-hat:7 guinea-pig:7 hundred-years-war:6
    october-revolution:6 deadliest-animal:5 koala:5 peanuts:6`,
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
