/** Story, changelog and privacy page tests: the content pack shape and
 *  rendering. */
import { suite, test, assert } from './runner.js';
import { renderStory } from '../about/story/story-lang.js';
import { STORY_EN } from '../about/story/story-en.js';
import { renderChangelog } from '../about/changelog/changelog-lang.js';
import { CHANGELOG_EN } from '../about/changelog/changelog-en.js';
import { renderPrivacy } from '../about/privacy/privacy-lang.js';
import { PRIVACY_EN } from '../about/privacy/privacy-en.js';

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

suite('changelog / content pack', () => {
  test('the pack carries title, heading, tagline, lede and dated sections', () => {
    assert.truthy(CHANGELOG_EN.title);
    assert.truthy(CHANGELOG_EN.heading);
    assert.truthy(CHANGELOG_EN.tagline);
    assert.truthy(CHANGELOG_EN.lede);
    assert.equal(CHANGELOG_EN.htmlLang, 'en');
    let previous = null;
    for (const section of CHANGELOG_EN.sections) {
      // The section headings are the dates — nothing but YYYY-MM-DD — and
      // the days run newest first.
      assert.truthy(/^\d{4}-\d{2}-\d{2}$/.test(section.h), `heading is a date: ${section.h}`);
      if (previous) assert.truthy(previous > section.h, `newest first: ${previous} > ${section.h}`);
      previous = section.h;
      assert.truthy(section.ps.length);
      for (const text of section.ps) assert.truthy(text);
    }
  });

  test('renderChangelog builds one section per entry, heading + paragraphs', () => {
    const els = {
      title: document.createElement('h1'),
      tagline: document.createElement('p'),
      lede: document.createElement('p'),
      sections: document.createElement('div'),
    };
    renderChangelog(els, CHANGELOG_EN);
    assert.equal(els.title.textContent, CHANGELOG_EN.heading);
    assert.equal(els.tagline.textContent, CHANGELOG_EN.tagline);
    assert.equal(els.lede.textContent, CHANGELOG_EN.lede);
    assert.equal(els.sections.children.length, CHANGELOG_EN.sections.length);
    const first = els.sections.children[0];
    assert.equal(first.children[0].tagName, 'H2');
    assert.equal(first.children[0].textContent, CHANGELOG_EN.sections[0].h);
    assert.equal(first.children.length, 1 + CHANGELOG_EN.sections[0].ps.length);
  });
});

suite('privacy / content pack', () => {
  test('the pack carries title, heading, tagline, lede and sections', () => {
    assert.truthy(PRIVACY_EN.title);
    assert.truthy(PRIVACY_EN.heading);
    assert.truthy(PRIVACY_EN.tagline);
    assert.truthy(PRIVACY_EN.lede);
    assert.equal(PRIVACY_EN.htmlLang, 'en');
    for (const section of PRIVACY_EN.sections) {
      assert.truthy(section.h);
      assert.truthy(section.ps.length);
      for (const text of section.ps) assert.truthy(text);
    }
  });

  test('renderPrivacy builds one section per entry, heading + paragraphs', () => {
    const els = {
      title: document.createElement('h1'),
      tagline: document.createElement('p'),
      lede: document.createElement('p'),
      sections: document.createElement('div'),
    };
    renderPrivacy(els, PRIVACY_EN);
    assert.equal(els.title.textContent, PRIVACY_EN.heading);
    assert.equal(els.tagline.textContent, PRIVACY_EN.tagline);
    assert.equal(els.lede.textContent, PRIVACY_EN.lede);
    assert.equal(els.sections.children.length, PRIVACY_EN.sections.length);
    const first = els.sections.children[0];
    assert.equal(first.children[0].tagName, 'H2');
    assert.equal(first.children[0].textContent, PRIVACY_EN.sections[0].h);
    assert.equal(first.children.length, 1 + PRIVACY_EN.sections[0].ps.length);
  });
});
