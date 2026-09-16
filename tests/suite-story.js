/** Story page tests: the language pack shape and rendering. */
import { suite, test, assert } from './runner.js';
import { renderStory } from '../story/story-lang.js';
import { STORY_EN } from '../story/story-en.js';

suite('story / language pack', () => {
  test('the pack carries title, heading, tagline, lede and sections', () => {
    assert.truthy(STORY_EN.title);
    assert.truthy(STORY_EN.heading);
    assert.truthy(STORY_EN.tagline);
    assert.truthy(STORY_EN.lede);
    assert.equal(STORY_EN.htmlLang, 'en');
    for (const section of STORY_EN.sections) {
      assert.truthy(section.h);
      assert.truthy(section.ps.length);
      for (const text of section.ps) assert.truthy(text);
    }
  });

  test('renderStory builds one section per entry, heading + paragraphs', () => {
    const els = {
      title: document.createElement('h1'),
      tagline: document.createElement('p'),
      lede: document.createElement('p'),
      sections: document.createElement('div'),
    };
    renderStory(els, STORY_EN);
    assert.equal(els.title.textContent, STORY_EN.heading);
    assert.equal(els.tagline.textContent, STORY_EN.tagline);
    assert.equal(els.lede.textContent, STORY_EN.lede);
    assert.equal(els.sections.children.length, STORY_EN.sections.length);
    const first = els.sections.children[0];
    assert.equal(first.children[0].tagName, 'H2');
    assert.equal(first.children[0].textContent, STORY_EN.sections[0].h);
    assert.equal(first.children.length, 1 + STORY_EN.sections[0].ps.length);
  });
});
