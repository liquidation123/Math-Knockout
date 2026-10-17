function calculateMass(materialUsed) {
  return 1 + materialUsed;
}

function calculateSpeed(power, mass) {
  return power / mass;
}

function calculateDistance(speed, friction) {
  if (friction <= 0) {
    return 0;
  }

  return (speed * speed) / (2 * friction);
}

function calculateImpact(mass1, mass2, speed1, speed2) {
  const effectiveMass = (mass1 * mass2) / (mass1 + mass2);
  const relativeSpeed = Math.abs(speed1 - speed2);