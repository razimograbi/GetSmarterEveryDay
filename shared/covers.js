// The photo on each topic's card. `npm run fetch-covers` downloads them into public/topics/,
// which is kept in the repository so a new server has them straight away.
// After changing one, run that and `npm run fetch-credits`.

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
  elements: 'File:Colour 18-col PT with labels.svg',
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
  history: 'File:Pyramids of the Giza Necropolis.jpg',
  trivia: 'File:Question mark 3d.png',
  unexpected: 'File:Penrose-dreieck.svg',
  sapiens: 'File:Lascaux painting.jpg',
  habits: 'File:2010-07-20 Black windup alarm clock face.jpg',
  sayno: 'File:ISO 7010 P001.svg',
};

/** Where a topic's photo is served from. Drawings are PNG, photos JPEG. */
export const coverSrc = (id) => `/topics/${id}.${/\.(png|svg)$/i.test(COVERS[id]) ? 'png' : 'jpg'}`;
