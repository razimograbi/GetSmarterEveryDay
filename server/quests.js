// The Levels: ten rounds of bank questions, played in order on the server (see server/play.js).
// The code calls them quests, because "level" already means a player's own level and
// shared/levels.js builds Quick rounds.
//
// This file stays on the server: a question's id often says its answer ("flag-jp").
//
// Each level takes its questions from one topic for now (`topic` could become a list later), plays
// them in the order written here, and no question is in two levels (`npm run validate` checks).
// The first levels use only the easiest questions of their topic and end on a medium one.
// `cover` is the topic whose photo the level shows (public/topics/).

import { QUESTION_BY_ID } from '../shared/questions.js';
import { pictureKeepsSecret } from './pictures.js';

export const QUESTS = [
  { id: 1, topic: 'flags', cover: 'flags', questions: ['flag-jp', 'flag-us', 'flag-gb', 'flag-fr', 'flag-za'] },
  { id: 2, topic: 'animals', cover: 'animals', questions: ['animals-lion', 'animals-elephant', 'animals-giraffe', 'animals-penguin', 'animals-dolphin', 'animals-capybara'] },
  { id: 3, topic: 'guns', cover: 'guns', questions: ['guns-revolver', 'guns-water-gun', 'guns-cannon', 'guns-ak-47', 'guns-bazooka', 'guns-uzi', 'guns-tavor'] },
  { id: 4, topic: 'food', cover: 'food', questions: ['food-pizza', 'food-hamburger', 'food-sushi', 'food-croissant', 'food-ice-cream', 'food-french-fries', 'food-doughnut', 'food-pad-thai'] },
  {
    id: 5, topic: 'logos', cover: 'logos',
    questions: ['logos-apple', 'logos-nike', 'logos-youtube', 'logos-mcdonald-s', 'logos-instagram', 'logos-facebook', 'logos-google', 'logos-whatsapp', 'logos-netflix', 'logos-mitsubishi'],
  },
  {
    id: 6, topic: 'landmarks', cover: 'landmarks',
    questions: [
      'landmarks-eiffel', 'landmarks-liberty', 'landmarks-giza', 'landmarks-pisa', 'landmarks-great-wall', 'landmarks-big-ben', 'landmarks-taj-mahal', 'landmarks-colosseum',
      'landmarks-golden-gate', 'landmarks-sagrada',
    ],
  },
  {
    id: 7, topic: 'capitals', cover: 'capitals',
    questions: [
      'capital-fr', 'capital-gb', 'capital-it', 'capital-jp', 'capital-es', 'capital-ru', 'capital-eg', 'capital-cn', 'capital-de', 'capital-gr', 'capital-us', 'capital-ca',
    ],
  },
  {
    id: 8, topic: 'people', cover: 'people',
    questions: [
      'people-einstein', 'people-nelson-mandela', 'people-mahatma-gandhi', 'people-abraham-lincoln', 'people-brad-pitt', 'people-will-smith', 'people-jackie-chan',
      'people-elvis-presley', 'people-michael-jordan', 'people-usain-bolt', 'people-obama', 'people-ronaldo', 'people-messi', 'people-michael-jackson', 'people-ali',
    ],
  },
  {
    id: 9, topic: 'music', cover: 'music',
    questions: [
      'music-piano', 'music-guitar', 'music-drum-kit', 'music-electric-guitar', 'music-triangle', 'music-maracas', 'music-gong', 'music-recorder', 'music-whistle', 'music-violin',
      'music-harp', 'music-trumpet', 'music-flute', 'music-saxophone', 'music-accordion', 'music-bagpipes', 'music-tambourine', 'music-harmonica', 'music-xylophone', 'music-didgeridoo',
    ],
  },
  {
    id: 10, topic: 'flags', cover: 'countries',
    questions: [
      'flag-cn', 'flag-il', 'flag-br', 'flag-ca', 'flag-es', 'flag-lb', 'flag-ua', 'flag-de', 'flag-it', 'flag-se', 'flag-ch', 'flag-mx', 'flag-in', 'flag-tr', 'flag-pt',
      'flag-sa', 'flag-at', 'flag-jm', 'flag-ma', 'flag-kp', 'flag-kr', 'flag-ru', 'flag-fi', 'flag-dk', 'flag-gr', 'flag-ar', 'flag-eg', 'flag-pk', 'flag-th', 'flag-vn',
    ],
  },
];

export const QUEST_BY_ID = new Map(QUESTS.map((quest) => [quest.id, quest]));

/**
 * The questions of a level that can be played now, in order. Like the Daily and duels, a level
 * leaves out a question whose picture has no copy on this server (`npm run fetch-images`),
 * because the picture's real address would name the answer.
 */
export const questQuestions = (quest, playable = pictureKeepsSecret) =>
  quest.questions.filter((id) => QUESTION_BY_ID.has(id) && playable(QUESTION_BY_ID.get(id)));

/** What's wrong with the levels as written, for `npm run validate` and the tests. */
export function questProblems() {
  const problems = [];
  const home = new Map(); // question id → the level it's in
  for (const quest of QUESTS) {
    const where = `level ${quest.id}`;
    if (!quest.questions.length) problems.push(`${where}: has no questions`);
    for (const id of quest.questions) {
      const q = QUESTION_BY_ID.get(id);
      if (!q) problems.push(`${where}: no question "${id}"`);
      else if (q.cat !== quest.topic) problems.push(`${where}: "${id}" is not in the topic ${quest.topic}`);
      if (home.has(id)) problems.push(`${where}: "${id}" is already in level ${home.get(id)}`);
      home.set(id, quest.id);
    }
  }
  if (new Set(QUESTS.map((quest) => quest.id)).size !== QUESTS.length) problems.push('levels: two levels share an id');
  return problems;
}
