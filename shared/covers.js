// The photo on each topic's card. `npm run fetch-covers` makes them in public/topics/, which is
// kept in the repository so a new server has them straight away.
//
// Phones keep these for good and never ask the server again (see public/sw.js), so after changing
// a photo raise COVERS_VERSION, or players will go on seeing the old one. Then run
// `npm run fetch-covers -- --force` and `npm run fetch-credits`.
export const COVERS_VERSION = 4;

export const COVERS = {
  flags: 'File:United Nations Flags - cropped.jpg',
  capitals: 'File:Skyscrapers of Shinjuku 2009 January.jpg',
  seas: 'File:Porto Covo Outubro 2014-3.jpg',
  signs: 'File:STOP sign.jpg',
  animals: 'File:020 The lion king Snyggve in the Serengeti National Park Photo by Giles Laurent.jpg',
  cars: 'File:1996 Porsche 911 993 GT2 - Flickr - The Car Spy (4).jpg',
  code: 'File:Code on computer monitor (Unsplash).jpg',
  landmarks: 'File:Taj Mahal (Edited).jpeg',
  dogs: 'File:Golden Retriever Dukedestiny01 drvd.jpg',
  food: 'File:Good Food Display - NCI Visuals Online.jpg',
  countries: 'File:The Great Globe, Guyot Hall, Princeton University.jpg',
  elements: 'File:Two small test tubes held in spring clamps.jpg',
  music: 'File:Historical instruments.jpg',
  paintings: 'File:Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg',
  body: 'File:Human-Skeleton.jpg',
  people: 'File:Albert Einstein Head.jpg',
  beauty: 'File:Cosmetics.JPG',
  jobs: 'File:FiremenFightBurningBarn.jpg',
  logos: 'File:New york times square-terabass.jpg',
  clubs: 'File:Camp Nou aerial (cropped).jpg',
  footballers: 'File:Norberto Alonso 1984.jpg',
  currencies: 'File:Euro coins and banknotes (cropped).jpg',
  guns: 'File:Handgun collection.JPG',
  history: 'File:Pyramids of the Giza Necropolis.jpg',
  trivia: 'File:Gold question mark 3d.png',
  unexpected: 'File:Hieronymus Bosch 051.jpg',
  sapiens: 'File:Lascaux painting.jpg',
  habits: 'File:Girls jog along Morro Strand State Beach.jpg',
  sayno: 'File:Qatar - Japan, AFC Asian Cup 2019 38.jpg',
};

/** Where a topic's photo is served from. The version in the address is what makes phones fetch a new one. */
export const coverSrc = (id) => `/topics/${id}.webp?v=${COVERS_VERSION}`;
