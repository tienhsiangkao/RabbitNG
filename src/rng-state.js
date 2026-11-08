// The main process owns draws; renderer acknowledgements cannot change them.
export function createRngRoll(entry, randomInt) {
  const value = randomInt(0, 100);
  const rollId = (entry.rngRollId || 0) + 1;
  entry.rngRollId = rollId;
  entry.lastRngValue = value;
  return { value, rollId };
}

export function commitRngRoll(entry, value, rollId) {
  if (!Number.isSafeInteger(rollId) || rollId <= 0 || rollId !== entry.rngRollId ||
      !Number.isInteger(value) || value < 0 || value > 99 || value !== entry.lastRngValue) {
    return false;
  }
  entry.lastCommittedRngValue = value;
  entry.committedRollId = rollId;
  return true;
}
