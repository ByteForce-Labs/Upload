const mongoose = require('mongoose');

// Game Constants
const REFERRAL_REWARD_TIERS = [
  { referrals: 5, reward: 1000 },
  { referrals: 10, reward: 2500 },
  { referrals: 25, reward: 5000 },
  { referrals: 50, reward: 10000 },
  { referrals: 100, reward: 25000 },
  { referrals: 500, reward: 50000 },
  { referrals: 1000, reward: 100000 }
];

const UPGRADE_SYSTEM = {
  multiTap: {
    points: [1000, 10000, 100000, 1000000], // For levels 1->2, 2->3, 3->4, 4->5
    powerPerLevel: [1, 2, 3, 4, 5], // Added level 5 base power
    starUpgrades: [
      { level: 6, stars: 10, reward: 100000, powerIncrease: 2 },
      { level: 7, stars: 20, reward: 500000, powerIncrease: 2 },
      { level: 8, stars: 50, reward: 1000000, powerIncrease: 2 }
    ]
  },
  speed: {
    points: [1000, 10000, 100000, 1000000], // For levels 1->2, 2->3, 3->4, 4->5
    refillTime: [40, 35, 30, 25, 20, 15, 10, 5],
    starUpgrades: [
      { level: 6, stars: 10, reward: 100000 },
      { level: 7, stars: 20, reward: 500000 },
      { level: 8, stars: 50, reward: 1000000 }
    ]
  },
  energyLimit: {
    points: [1000, 10000, 100000, 1000000], // For levels 1->2, 2->3, 3->4, 4->5
    capacity: [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000],
    starUpgrades: [
      { level: 6, stars: 10, reward: 100000 },
      { level: 7, stars: 20, reward: 500000 },
      { level: 8, stars: 50, reward: 1000000 }
    ]
  }
};

const AUTO_TAP_BOT_CONFIG = {
  levels: {
    free: { duration: 2, starCost: 0, validityDays: 1 },
    basic: { duration: 7, starCost: 20, validityDays: 7 },
    advanced: { duration: 14, starCost: 50, validityDays: 7 },
    premium: { duration: 24, starCost: 100, validityDays: 7 }
  }
};

// Schema Definitions
const referralRewardSchema = new mongoose.Schema({
  referrals: {
    type: Number,
    required: true,
    validate: {
      validator: value => REFERRAL_REWARD_TIERS.some(tier => tier.referrals === value),
      message: props => `${props.value} is not a valid referral tier!`
    }
  },
  reward: {
    type: Number,
    required: true,
    validate: {
      validator: function(value) {
        const tier = REFERRAL_REWARD_TIERS.find(t => t.referrals === this.referrals);
        return tier && tier.reward === value;
      },
      message: props => `${props.value} is not the correct reward for this tier!`
    }
  },
  claimed: { type: Boolean, default: false }
});

const directReferralSchema = new mongoose.Schema({
  username: { type: String, required: true },
  userId: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now },
  pointsEarned: { type: Number, default: 0, min: 0 }
});

const indirectReferralSchema = new mongoose.Schema({
  username: { type: String, required: true },
  userId: { type: String, required: true },
  referredBy: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now },
  pointsEarned: { type: Number, default: 0, min: 0 }
});

const autoTapBotSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['free', 'basic', 'advanced', 'premium'],
    default: 'free'
  },
  validUntil: Date,
  lastClaimed: Date,
  isActive: { type: Boolean, default: false }
});

const achievementSchema = new mongoose.Schema({
  name: String,
  description: String,
  earnedAt: { type: Date, default: Date.now },
  type: {
    type: String,
    enum: ['TAP', 'UPGRADE', 'REFERRAL', 'CHECKIN', 'SPECIAL']
  },
  reward: Number
});

const statisticsSchema = new mongoose.Schema({
  totalTaps: { type: Number, default: 0, min: 0 },
  totalPowerGenerated: { type: Number, default: 0, min: 0 },
  longestCheckInStreak: { type: Number, default: 0, min: 0 },
  totalCheckIns: { type: Number, default: 0, min: 0 },
  highestLevel: {
    multiTap: { type: Number, default: 1 },
    speed: { type: Number, default: 1 },
    energyLimit: { type: Number, default: 1 }
  }
});

// Main User Schema
const userSchema = new mongoose.Schema({
  // Identity
  username: { type: String, required: true, unique: true, trim: true },
  userId: { type: String, required: true, unique: true, trim: true },
  
  // Game Mechanics
  energy: { type: Number, default: 500, min: 0 },
  maxEnergy: { type: Number, default: 500, min: 500 },
  tapPower: { type: Number, default: 1, min: 1 },
  lastTapTime: { type: Date, default: Date.now },
  
  // Levels
  multiTapLevel: { type: Number, default: 1, min: 1, max: 8 },
  speedLevel: { type: Number, default: 1, min: 1, max: 8 },
  energyLimitLevel: { type: Number, default: 1, min: 1, max: 8 },
  
  // Currency
  stars: { type: Number, default: 0, min: 0 },
  power: { type: Number, default: 0, min: 0 },
  checkInPoints: { type: Number, default: 0, min: 0 },
  referralPoints: { type: Number, default: 0, min: 0 },
  
  // Systems
  lastCheckIn: Date,
  checkInStreak: { type: Number, default: 0, min: 0 },
  referral: { type: String, default: null, trim: true },
  directReferrals: [directReferralSchema],
  indirectReferrals: [indirectReferralSchema],
  referralRewards: {
    type: [referralRewardSchema],
    default: () => REFERRAL_REWARD_TIERS.map(tier => ({
      referrals: tier.referrals,
      reward: tier.reward,
      claimed: false
    })),
    validate: {
      validator: function(rewards) {
        const hasTiers = REFERRAL_REWARD_TIERS.every(tier =>
          rewards.some(r => r.referrals === tier.referrals && r.reward === tier.reward)
        );
        const uniqueTiers = new Set(rewards.map(r => r.referrals));
        return hasTiers && uniqueTiers.size === REFERRAL_REWARD_TIERS.length;
      },
      message: 'Referral rewards must contain all valid tiers without duplicates'
    }
  },
  
  autoTapBot: autoTapBotSchema,
  statistics: statisticsSchema,
  achievements: [achievementSchema],
  
  isActive: { type: Boolean, default: true },
  lastActive: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
userSchema.virtual('totalPoints').get(function() {
  return this.power + this.checkInPoints + this.referralPoints;
});

userSchema.virtual('rewardTierStatus').get(function() {
  const totalReferrals = this.directReferrals.length;
  return REFERRAL_REWARD_TIERS.map(tier => ({
    referrals: tier.referrals,
    reward: tier.reward,
    qualified: totalReferrals >= tier.referrals,
    claimed: this.referralRewards.find(r => r.referrals === tier.referrals && r.claimed),
    claimable: totalReferrals >= tier.referrals && 
      !this.referralRewards.find(r => r.referrals === tier.referrals && r.claimed)
  }));
});

// Methods
userSchema.methods = {
  calculateEnergyRegeneration() {
    const now = Date.now();
    const timeDiff = (now - this.lastTapTime) / (60 * 1000); // Minutes
    const regenTime = UPGRADE_SYSTEM.speed.refillTime[this.speedLevel - 1];
    const regeneratedEnergy = Math.floor(timeDiff * (this.maxEnergy / regenTime));
    return Math.min(this.maxEnergy, this.energy + regeneratedEnergy);
  },

  getTapPower() {
    const baseLevel = Math.min(this.multiTapLevel, 5);
    const basePower = UPGRADE_SYSTEM.multiTap.powerPerLevel[baseLevel - 1];
    const starBonus = this.multiTapLevel > 5 ? 
      UPGRADE_SYSTEM.multiTap.starUpgrades
        .slice(0, this.multiTapLevel - 5)
        .reduce((sum, upgrade) => sum + upgrade.powerIncrease, 0) : 0;
    return basePower + starBonus;
  },

  getUpgradeCost(type) {
    const level = this[`${type}Level`];
    if (level >= 8) return null;
    
    if (level <= 5) {
      // Level 1-5 use points
      return { points: UPGRADE_SYSTEM[type].points[level - 1] };
    }
    
    // Levels 6-8 use stars
    const starUpgrade = UPGRADE_SYSTEM[type].starUpgrades[level - 6];
    return {
      stars: starUpgrade.stars,
      reward: starUpgrade.reward,
      additionalEffects: type === 'multiTap' ? { powerIncrease: starUpgrade.powerIncrease } : null
    };
  },

  canClaimReward(referralCount) {
    const tier = REFERRAL_REWARD_TIERS.find(t => t.referrals === referralCount);
    if (!tier) return false;
    
    const reward = this.referralRewards.find(r => r.referrals === referralCount);
    return reward && !reward.claimed && this.directReferrals.length >= referralCount;
  },

  getNextClaimableReward() {
    return this.referralRewards
      .filter(r => !r.claimed && this.directReferrals.length >= r.referrals)
      .sort((a, b) => a.referrals - b.referrals)[0];
  },

  getBotConfig() {
    return AUTO_TAP_BOT_CONFIG.levels[this.autoTapBot.level];
  }
};

// Middleware
userSchema.pre('save', function(next) {
  if (this.isModified('energyLimitLevel')) {
    this.maxEnergy = UPGRADE_SYSTEM.energyLimit.capacity[this.energyLimitLevel - 1];
  }
  
  if (this.isModified('multiTapLevel')) {
    this.tapPower = this.getTapPower();
  }
  
  if (this.isModified('checkInStreak')) {
    this.statistics.longestCheckInStreak = Math.max(
      this.statistics.longestCheckInStreak,
      this.checkInStreak
    );
  }
  
  if (this.isModified('power')) {
    this.statistics.totalPowerGenerated = this.power;
  }
  
  if (this.isModified('multiTapLevel') || 
      this.isModified('speedLevel') || 
      this.isModified('energyLimitLevel')) {
    this.statistics.highestLevel = {
      multiTap: Math.max(this.statistics.highestLevel.multiTap, this.multiTapLevel),
      speed: Math.max(this.statistics.highestLevel.speed, this.speedLevel),
      energyLimit: Math.max(this.statistics.highestLevel.energyLimit, this.energyLimitLevel)
    };
  }
  
  this.lastActive = new Date();
  next();
});

// Indexes
userSchema.index({ username: 1 });
userSchema.index({ userId: 1 });
userSchema.index({ power: -1 });
userSchema.index({ referral: 1 });
userSchema.index({ 'directReferrals.username': 1 });
userSchema.index({ 'indirectReferrals.username': 1 });
userSchema.index({ lastCheckIn: 1 });
userSchema.index({ isActive: 1, lastActive: -1 });

const User = mongoose.model('User', userSchema);

module.exports = {
  User,
  UPGRADE_SYSTEM,
  AUTO_TAP_BOT_CONFIG,
  REFERRAL_REWARD_TIERS
};