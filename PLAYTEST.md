# Playtest notes

Notes from playing the three-image practice prototype (#19). They feed the open gameplay decisions in #21: scoring values, wrong-guess rules, the number of reveal steps and typo tolerance.

**How to playtest:** open the live site, click **Start practice** and play all three images. Then play once more trying a different strategy, such as guessing early or zooming all the way out. Write down what you noticed right away, in your own words.

Current values (`src/game/scoring-config.ts`): 100 points per image, −20 per zoom-out, −10 per wrong guess, at least 10 for a correct answer, 0 for a skip.

## Questions to answer

- Was the first crop too easy, too hard, or about right? (Each image.)
- Did zooming out feel worth the cost? Did you zoom out, or just guess?
- Did wrong guesses feel too cheap or too expensive?
- Were there answers you knew but the game didn't accept (typos, plurals, punctuation)?
- Was anything confusing on the start screen, while playing or on the final score screen?
- Did it work on your phone?

## Notes

### Jacky
- TODO

### Darian
- TODO

### Joseph
- TODO

### Ethan
- TODO

## Decisions

Record what we change because of these notes in #21 and `PROJECT_BRIEF.md`.
