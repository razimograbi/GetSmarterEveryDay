// Hebrew language pack: interface text, topic names and the question bank's strings.
// Question strings are keyed by their English text ("topic|English" where one topic needs a different word).
import { ui, cats } from './ui.js';
import geo from './q-geo.js';
import signs from './q-signs.js';
import nature from './q-nature.js';
import culture from './q-culture.js';
import history from './q-history.js';
import sapiens from './q-sapiens.js';
import habits from './q-habits.js';
import sayno from './q-sayno.js';
import more from './q-more.js';
import sport from './q-sport.js';
import extra from './q-extra.js';
import guns from './q-guns.js';

export default { ui, cats, questions: { ...geo, ...signs, ...nature, ...culture, ...history, ...sapiens, ...habits, ...sayno, ...more, ...sport, ...extra, ...guns } };
