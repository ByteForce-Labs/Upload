const { User, UPGRADE_SYSTEM, AUTO_TAP_BOT_CONFIG, REFERRAL_REWARD_TIERS } = require('../models/User');
const mongoose = require('mongoose');

// Helper Functions

const calculateCurrentEnergy = (lastTapTime, currentEnergy, maxEnergy, regenTimeInMinutes) => {
  const now = Date.now();
  const timeDiffSeconds = (now - lastTapTime) / 1000;
  const regenTimeInSeconds = regenTimeInMinutes * 60;
  const energyPerSecond = maxEnergy / regenTimeInSeconds;
  const regeneratedEnergy = timeDiffSeconds * energyPerSecond;
  
  return Math.min(maxEnergy, currentEnergy + regeneratedEnergy);
};

const calculatePendingPower = (user, now = Date.now()) => {
  if (!user.autoTapBot?.isActive) {
    return { pendingPower: 0, details: null };
  }

  const lastClaimed = user.autoTapBot.lastClaimed;
  const config = AUTO_TAP_BOT_CONFIG.levels[user.autoTapBot.level];
  const activationTime = new Date(user.autoTapBot.validUntil.getTime() - 
    (config.validityDays * 24 * 60 * 60 * 1000));

  // Handle free tier (2 hours only)
  if (user.autoTapBot.level === 'free') {
    const miningEndTime = new Date(activationTime.getTime() + (2 * 60 * 60 * 1000));
    const isMining = now < miningEndTime;
    
    if (isMining) {
      return {
        pendingPower: 0,
        details: {
          timeElapsed: 0,
          totalTaps: 0,
          powerPerTap: user.getTapPower(),
          energyUsed: 0,
          botInfo: {
            level: 'free',
            validUntil: user.autoTapBot.validUntil,
            lastClaimed: lastClaimed,
            duration: 2,
            isMining,
            miningComplete: !isMining,
            canClaim: !isMining,
            miningStartTime: activationTime,
            miningEndTime,
            remainingTime: {
              minutes: Math.floor((miningEndTime - now) / (60 * 1000)),
              seconds: Math.floor((miningEndTime - now) / 1000 % 60),
              total: {
                minutes: Math.floor((miningEndTime - now) / (60 * 1000)),
                seconds: Math.floor((miningEndTime - now) / 1000)
              }
            }
          }
        }
      };
    }

    // Calculate rewards after mining complete
    const timeElapsed = 2 * 60 * 60;
    const tapsPerSecond = user.speedLevel;
    const totalTaps = Math.floor(timeElapsed * tapsPerSecond);
    const tapPower = user.getTapPower();

    return {
      pendingPower: totalTaps * tapPower,
      details: {
        timeElapsed,
        totalTaps,
        powerPerTap: tapPower,
        energyUsed: Math.min(totalTaps, user.maxEnergy),
        botInfo: {
          level: 'free',
          validUntil: user.autoTapBot.validUntil,
          lastClaimed: lastClaimed,
          duration: 2,
          isMining: false,
          miningComplete: true,
          canClaim: true,
          miningStartTime: activationTime,
          miningEndTime
        }
      }
    };
  }

  // Handle paid tiers (daily mining windows)
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  const activationHour = activationTime.getHours();
  let miningStartTime = new Date(todayStart);
  miningStartTime.setHours(activationHour, activationTime.getMinutes(), 0, 0);
  
  if (now < miningStartTime.getTime()) {
    miningStartTime = new Date(miningStartTime.getTime() - (24 * 60 * 60 * 1000));
  }
  
  const miningEndTime = new Date(miningStartTime.getTime() + (config.duration * 60 * 60 * 1000));
  const isMining = now >= miningStartTime && now <= miningEndTime;

  if (isMining) {
    return {
      pendingPower: 0,
      details: {
        timeElapsed: 0,
        totalTaps: 0,
        powerPerTap: user.getTapPower(),
        energyUsed: 0,
        botInfo: {
          level: user.autoTapBot.level,
          validUntil: user.autoTapBot.validUntil,
          lastClaimed: lastClaimed,
          duration: config.duration,
          isMining,
          miningComplete: !isMining,
          canClaim: !isMining,
          miningStartTime,
          miningEndTime,
          remainingTime: {
            minutes: Math.floor((miningEndTime - now) / (60 * 1000)),
            seconds: Math.floor((miningEndTime - now) / 1000 % 60)
          }
        }
      }
    };
  }

  const timeElapsed = config.duration * 60 * 60;
  const tapsPerSecond = user.speedLevel;
  const totalTaps = Math.floor(timeElapsed * tapsPerSecond);
  const tapPower = user.getTapPower();

  return {
    pendingPower: totalTaps * tapPower,
    details: {
      timeElapsed,
      totalTaps,
      powerPerTap: tapPower,
      energyUsed: Math.min(totalTaps, user.maxEnergy),
      botInfo: {
        level: user.autoTapBot.level,
        validUntil: user.autoTapBot.validUntil,
        lastClaimed: lastClaimed,
        duration: config.duration,
        isMining: false,
        miningComplete: true,
        canClaim: true,
        miningStartTime,
        miningEndTime
      }
    }
  };
};


// User Registration
const registerUser = async (req, res) => {
  try {
    const { username, userId, referral } = req.body;

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    let directReferrer = null;
    let indirectReferrer = null;

    if (referral) {
      directReferrer = await User.findOne({ username: referral });
      if (!directReferrer) {
        return res.status(400).json({ message: 'Referral username does not exist' });
      }

      if (directReferrer.referral) {
        indirectReferrer = await User.findOne({ username: directReferrer.referral });
      }
    }

    const initialReferralRewards = REFERRAL_REWARD_TIERS.map(tier => ({
      referrals: tier.referrals,
      reward: tier.reward,
      claimed: false
    }));

    const newUser = new User({
      username,
      userId,
      referral: referral ? directReferrer.username : null,
      referralRewards: initialReferralRewards
    });

    if (directReferrer) {
      directReferrer.referralPoints += 500;
      directReferrer.directReferrals.push({
        username,
        userId,
        pointsEarned: 500
      });
      await directReferrer.save();

      if (indirectReferrer) {
        indirectReferrer.referralPoints += 100;
        indirectReferrer.indirectReferrals.push({
          username,
          userId,
          referredBy: directReferrer.username,
          pointsEarned: 100
        });
        await indirectReferrer.save();
      }
    }

    await newUser.save();

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        username: newUser.username,
        userId: newUser.userId,
        referral: newUser.referral,
        referralRewards: newUser.referralRewards
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Game Mechanics
const handleTap = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.body;
    if (!userId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'userId is required' });
    }

    const user = await User.findOne({ userId }).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.statistics) {
      user.statistics = {
        totalTaps: 0,
        totalPowerGenerated: 0,
        longestCheckInStreak: 0,
        totalCheckIns: 0,
        highestLevel: {
          multiTap: user.multiTapLevel || 1,
          speed: user.speedLevel || 1,
          energyLimit: user.energyLimitLevel || 1
        }
      };
    }

    const now = Date.now();
    const regenTimeInMinutes = UPGRADE_SYSTEM.speed.refillTime[user.speedLevel - 1];
    const regenTimeInSeconds = regenTimeInMinutes * 60;
    const energyPerSecond = user.maxEnergy / regenTimeInSeconds;
    
    const currentEnergy = calculateCurrentEnergy(
      user.lastTapTime,
      user.energy,
      user.maxEnergy,
      regenTimeInMinutes
    );

    const tapPower = user.getTapPower();
    
    if (currentEnergy < tapPower) {
      const timeToNextEnergy = (tapPower - currentEnergy) / energyPerSecond;
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Not enough energy',
        currentEnergy: currentEnergy,
        maxEnergy: user.maxEnergy,
        secondsToNextEnergy: Math.ceil(timeToNextEnergy),
        regenRatePerSecond: energyPerSecond,
        requiredEnergy: tapPower
      });
    }

    user.energy = currentEnergy - tapPower;
    user.lastTapTime = now;
    user.power += tapPower;
    user.statistics.totalTaps = (user.statistics.totalTaps || 0) + 1;
    user.statistics.totalPowerGenerated = (user.statistics.totalPowerGenerated || 0) + tapPower;

    await user.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Tap successful',
      powerGained: tapPower,
      currentStats: {
        energy: user.energy,
        maxEnergy: user.maxEnergy,
        power: user.power,
        totalTaps: user.statistics.totalTaps,
        powerPerTap: tapPower,
        energyRegenRate: energyPerSecond,
        energyCost: tapPower
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Tap error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};


const activateAutoTapBot = async (req, res) => {
  const { userId, level = 'free' } = req.body;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();

    // Check if any bot tier is currently active within its validity period
    if (user.autoTapBot?.isActive && now < user.autoTapBot.validUntil) {
      return res.status(400).json({
        message: 'Another bot tier is currently active',
        currentBot: {
          level: user.autoTapBot.level,
          validUntil: user.autoTapBot.validUntil,
          timeRemaining: {
            milliseconds: user.autoTapBot.validUntil - now,
            hours: Math.floor((user.autoTapBot.validUntil - now) / (1000 * 60 * 60)),
            minutes: Math.floor((user.autoTapBot.validUntil - now) / (1000 * 60) % 60),
            seconds: Math.floor((user.autoTapBot.validUntil - now) / 1000 % 60)
          }
        },
        nextActivationTime: user.autoTapBot.validUntil
      });
    }

    const botConfig = AUTO_TAP_BOT_CONFIG.levels[level];
    if (!botConfig) {
      return res.status(400).json({ 
        message: 'Invalid bot level',
        availableLevels: Object.keys(AUTO_TAP_BOT_CONFIG.levels)
      });
    }

    // Set validity period based on tier
    const validityDays = level === 'free' ? 1 : 7;
    
    // Set up new bot
    user.autoTapBot = {
      level,
      validUntil: new Date(now.getTime() + (validityDays * 24 * 60 * 60 * 1000)),
      lastClaimed: now,
      isActive: true
    };

    await user.save();

    // Calculate mining end time based on tier
    const miningEndTime = level === 'free' ? 
      new Date(now.getTime() + (2 * 60 * 60 * 1000)) : // 2 hours for free
      new Date(now.setHours(23, 59, 59, 999)); // Until midnight for paid tiers

    const remainingMillis = miningEndTime.getTime() - now.getTime();

    res.status(200).json({
      message: 'Auto tap bot activated successfully',
      botStatus: {
        level,
        validUntil: user.autoTapBot.validUntil,
        lastClaimed: user.autoTapBot.lastClaimed,
        isActive: true,
        miningEndTime,
        config: {
          dailyHours: botConfig.duration,
          validityDays,
          starCost: botConfig.starCost
        },
        remainingTime: {
          minutes: Math.floor(remainingMillis / (60 * 1000)),
          seconds: Math.floor(remainingMillis / 1000),
          total: {
            minutes: Math.floor(remainingMillis / (60 * 1000)),
            seconds: Math.floor(remainingMillis / 1000)
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Activation failed', error: error.message });
  }
};


const upgradeLevel = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, upgradeType, useStar = false } = req.body;

    const user = await User.findOne({ userId }).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize statistics if they don't exist
    if (!user.statistics) {
      user.statistics = {
        totalTaps: 0,
        totalPowerGenerated: 0,
        longestCheckInStreak: 0,
        totalCheckIns: 0,
        highestLevel: {
          multiTap: user.multiTapLevel || 1,
          speed: user.speedLevel || 1,
          energyLimit: user.energyLimitLevel || 1
        }
      };
    }

    const currentLevel = user[`${upgradeType}Level`];
    const nextLevel = currentLevel + 1;

    // Check maximum level
    if (nextLevel > 8) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Maximum level reached' });
    }

    if (!useStar) {
      // Point upgrade (levels 1-5)
      if (nextLevel > 5) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Point upgrades only available for levels 1-5' });
      }

      const pointCost = UPGRADE_SYSTEM[upgradeType].points[currentLevel - 1];
      if (user.power < pointCost) {
        await session.abortTransaction();
        return res.status(400).json({
          message: 'Insufficient points',
          required: pointCost,
          current: user.power
        });
      }

      // Deduct points and update level
      user.power -= pointCost;
      user[`${upgradeType}Level`] = nextLevel;

      // Update tapPower for multiTap upgrades
      if (upgradeType === 'multiTap') {
        user.tapPower = UPGRADE_SYSTEM.multiTap.powerPerLevel[nextLevel - 1];
      }
    } else {
      // Star upgrade logic
      if (nextLevel < 6) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Star upgrades only available for levels 6-8' });
      }

      const starUpgrade = UPGRADE_SYSTEM[upgradeType].starUpgrades[nextLevel - 6];
      user.power += starUpgrade.reward;
      user[`${upgradeType}Level`] = nextLevel;

      if (upgradeType === 'multiTap' && starUpgrade.powerIncrease) {
        user.tapPower += starUpgrade.powerIncrease;
      }
    }

    // Update highest level in statistics
    user.statistics.highestLevel[upgradeType] = Math.max(
      user.statistics.highestLevel[upgradeType],
      nextLevel
    );

    await user.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Upgrade successful',
      upgradeType,
      newLevel: nextLevel,
      stats: {
        power: user.power,
        tapPower: user.getTapPower(),
        maxEnergy: user.maxEnergy,
        regenTime: UPGRADE_SYSTEM.speed.refillTime[user.speedLevel - 1],
        level: nextLevel
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Upgrade error:', error);
    res.status(500).json({ message: 'Upgrade failed', error: error.message });
  } finally {
    session.endSession();
  }
};

const getAutoBotStatus = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.autoTapBot?.isActive) {
      return res.status(200).json({
        isActive: false,
        availableLevels: Object.entries(AUTO_TAP_BOT_CONFIG.levels).map(([level, config]) => ({
          level,
          starCost: config.starCost,
          duration: config.duration,
          validityDays: config.validityDays
        }))
      });
    }

    const { pendingPower, details } = calculatePendingPower(user);

    res.status(200).json({
      botStatus: {
        isActive: true,
        level: user.autoTapBot.level,
        validUntil: user.autoTapBot.validUntil,
        lastClaimed: user.autoTapBot.lastClaimed,
        pendingPower,
        canClaim: pendingPower > 0,
        remainingTime: details.botInfo.remainingTime,
        isMining: details.botInfo.isMining,
        miningEndTime: details.botInfo.miningEndTime,
        ...details
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


const getAutoBotEarnings = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.autoTapBot?.isActive) {
      return res.status(400).json({ message: 'Auto tap bot is not active' });
    }

    const { pendingPower, details } = calculatePendingPower(user);

    if (details.botInfo.isMining) {
      return res.status(400).json({ 
        message: 'Cannot claim while mining is in progress',
        botInfo: details.botInfo
      });
    }

    if (pendingPower <= 0) {
      return res.status(400).json({
        message: 'No earnings to claim',
        botInfo: details.botInfo
      });
    }

    // Initialize statistics if needed
    if (!user.statistics) {
      user.statistics = {
        totalTaps: 0,
        totalPowerGenerated: 0,
        longestCheckInStreak: 0,
        totalCheckIns: 0,
        highestLevel: {
          multiTap: user.multiTapLevel || 1,
          speed: user.speedLevel || 1,
          energyLimit: user.energyLimitLevel || 1
        }
      };
    }

    // Update user stats and deactivate bot
    user.power += pendingPower;
    user.energy = Math.max(0, user.maxEnergy - details.energyUsed);
    user.statistics.totalTaps += details.totalTaps;
    user.statistics.totalPowerGenerated += pendingPower;
    user.autoTapBot.isActive = false;

    await user.save();

    res.status(200).json({
      message: 'Auto bot earnings claimed successfully',
      earnings: {
        timeElapsed: details.timeElapsed,
        totalTaps: details.totalTaps,
        powerGained: pendingPower,
        energyUsed: details.energyUsed,
        currentStats: {
          energy: user.energy,
          power: user.power,
          totalTaps: user.statistics.totalTaps
        },
        botStatus: {
          ...details.botInfo,
          isActive: false
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to claim earnings', error: error.message });
  }
};


const getPendingAutoBotEarnings = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.autoTapBot?.isActive) {
      return res.status(400).json({ message: 'Auto tap bot not active' });
    }

    const { pendingPower, details } = calculatePendingPower(user);

    res.status(200).json({
      pendingPower,
      canClaim: pendingPower > 0,
      ...details
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Check-in System
const performDailyCheckIn = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
    
    if (!lastCheckIn || 
        now.getUTCDate() !== lastCheckIn.getUTCDate() || 
        now.getUTCMonth() !== lastCheckIn.getUTCMonth() || 
        now.getUTCFullYear() !== lastCheckIn.getUTCFullYear()) {
      
      let reward;
      if (!lastCheckIn || now - lastCheckIn > 24 * 60 * 60 * 1000) {
        user.checkInStreak = 0;
        reward = 1000;
      } else {
        user.checkInStreak += 1;
        if (user.checkInStreak % 7 === 0) {
          reward = user.checkInStreak === 7 ? 25000 : 
            Math.min(50000 * Math.floor(user.checkInStreak / 7), 250000);
        } else {
          reward = 5000;
        }
      }

      user.lastCheckIn = now;
      user.checkInPoints += reward;
      user.statistics.totalCheckIns += 1;

      await user.save();

      res.status(200).json({
        message: 'Check-in successful',
        reward,
        stats: {
          streak: user.checkInStreak,
          totalCheckIns: user.statistics.totalCheckIns,
          checkInPoints: user.checkInPoints
        }
      });
    } else {
      res.status(400).json({ message: 'Already checked in today' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getCheckInStatus = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
    const canCheckIn = !lastCheckIn || 
      now.getUTCDate() !== lastCheckIn.getUTCDate() || 
      now.getUTCMonth() !== lastCheckIn.getUTCMonth() || 
      now.getUTCFullYear() !== lastCheckIn.getUTCFullYear();

    let nextReward = 0;
    if (canCheckIn) {
      if (!lastCheckIn || now - lastCheckIn > 48 * 60 * 60 * 1000) {
        nextReward = 1000;
      } else {
        const nextStreak = user.checkInStreak + 1;
        if (nextStreak % 7 === 0) {
          nextReward = nextStreak === 7 ? 25000 : 
            Math.min(50000 * Math.floor(nextStreak / 7), 250000);
        } else {
          nextReward = 5000;
        }
      }
    }

    res.status(200).json({
      status: {
        lastCheckIn: user.lastCheckIn,
        streak: user.checkInStreak,
        canCheckIn,
        nextReward,
        stats: {
          totalCheckIns: user.statistics.totalCheckIns,
          longestStreak: user.statistics.longestCheckInStreak,
          checkInPoints: user.checkInPoints
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Referral System
const getReferralDetails = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const details = {
      myReferralCode: user.username,
      directReferrals: {
        count: user.directReferrals.length,
        totalPoints: user.directReferrals.reduce((sum, ref) => sum + ref.pointsEarned, 0),
        referrals: user.directReferrals.map(ref => ({
          username: ref.username,
          joinedAt: ref.joinedAt,
          pointsEarned: ref.pointsEarned
        }))
      },
      indirectReferrals: {
        count: user.indirectReferrals.length,
        totalPoints: user.indirectReferrals.reduce((sum, ref) => sum + ref.pointsEarned, 0),
        referrals: user.indirectReferrals.map(ref => ({
          username: ref.username,
          referredBy: ref.referredBy,
          joinedAt: ref.joinedAt,
          pointsEarned: ref.pointsEarned
        }))
      },
      totalReferralPoints: user.referralPoints
    };

    res.status(200).json({ referralDetails: details });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getReferralRewardStatus = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const totalReferrals = user.directReferrals.length;
    const claimableRewards = user.referralRewards
      .filter(reward => totalReferrals >= reward.referrals && !reward.claimed)
      .sort((a, b) => a.referrals - b.referrals);

    const nextReward = user.referralRewards
      .filter(reward => totalReferrals < reward.referrals && !reward.claimed)
      .sort((a, b) => a.referrals - b.referrals)[0];

    res.status(200).json({
      totalReferrals,
      claimableRewards: claimableRewards.map(r => ({
        referrals: r.referrals,
        reward: r.reward
      })),
      nextReward: nextReward ? {
        referralsNeeded: nextReward.referrals - totalReferrals,
        referrals: nextReward.referrals,
        reward: nextReward.reward
      } : null,
      allRewards: user.referralRewards.map(r => ({
        referrals: r.referrals,
        reward: r.reward,
        claimed: r.claimed,
        qualified: totalReferrals >= r.referrals
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const claimReferralReward = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const totalReferrals = user.directReferrals.length;
    const claimableReward = user.getNextClaimableReward();

    if (!claimableReward) {
      return res.status(400).json({
        message: 'No rewards available to claim',
        totalReferrals,
        nextRequired: user.referralRewards.find(r => 
          !r.claimed && r.referrals > totalReferrals
        )?.referrals
      });
    }

    const rewardIndex = user.referralRewards.findIndex(r => 
      r.referrals === claimableReward.referrals
    );
    
    user.referralRewards[rewardIndex].claimed = true;
    user.referralPoints += claimableReward.reward;
    await user.save();

    res.status(200).json({
      message: 'Reward claimed successfully',
      claimed: {
        referrals: claimableReward.referrals,
        reward: claimableReward.reward
      },
      newTotal: user.referralPoints,
      nextReward: user.getNextClaimableReward()
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// User Information
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, 'username userId power');
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getUserStatistics = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({
      statistics: user.statistics,
      levels: {
        multiTap: user.multiTapLevel,
        speed: user.speedLevel,
        energyLimit: user.energyLimitLevel
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getUserAchievements = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({ achievements: user.achievements });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};



// Energy Management
const getEnergyStatus = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const currentEnergy = user.calculateEnergyRegeneration();
    
    res.status(200).json({
      energy: currentEnergy,
      maxEnergy: user.maxEnergy,
      regenTime: UPGRADE_SYSTEM.speed.refillTime[user.speedLevel - 1]
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const refillEnergy = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.energy = user.maxEnergy;
    user.lastTapTime = new Date();
    await user.save();

    res.status(200).json({
      message: 'Energy refilled successfully',
      energy: user.energy,
      maxEnergy: user.maxEnergy
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// Update the monitorUserStatus function to use the same calculation
const monitorUserStatus = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const regenTimeInMinutes = UPGRADE_SYSTEM.speed.refillTime[user.speedLevel - 1];
    const currentEnergy = calculateCurrentEnergy(
      user.lastTapTime,
      user.energy,
      user.maxEnergy,
      regenTimeInMinutes
    );

    if (user.energy !== currentEnergy) {
      user.energy = currentEnergy;
      user.lastTapTime = Date.now();
      await user.save();
    }

    res.status(200).json({
      message: 'Status retrieved successfully',
      status: {
        username: user.username,
        userId: user.userId,
        energy: currentEnergy,
        maxEnergy: user.maxEnergy,
        tapPower: user.getTapPower(),
        levels: {
          multiTap: user.multiTapLevel,
          speed: user.speedLevel,
          energyLimit: user.energyLimitLevel
        },
        scores: {
          power: user.power,
          checkInPoints: user.checkInPoints,
          referralPoints: user.referralPoints,
          totalPoints: user.totalPoints
        },
        botStatus: user.autoTapBot,
        timing: {
          regenTime: regenTimeInMinutes,
          lastTapTime: user.lastTapTime,
          currentTime: Date.now(),
          energyRegenRate: user.maxEnergy / (regenTimeInMinutes * 60)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// Helper function to generate leaderboard response
const generateLeaderboardResponse = (users, metric, limit = 100) => {
  return users.slice(0, limit).map((user, index) => ({
    rank: index + 1,
    username: user.username,
    userId: user.userId,
    value: user[metric],
    timestamp: new Date()
  }));
};

// Get Power Leaderboard
const getPowerLeaderboard = async (req, res) => {
  try {
    const users = await User.find({}, 'username userId power')
      .sort({ power: -1 })
      .limit(100)
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).json({
        message: 'No users found',
        leaderboard: []
      });
    }

    const leaderboard = generateLeaderboardResponse(users, 'power');

    res.status(200).json({
      message: 'Power leaderboard retrieved successfully',
      leaderboard,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve power leaderboard',
      error: error.message
    });
  }
};

// Get Energy Leaderboard
const getEnergyLeaderboard = async (req, res) => {
  try {
    const users = await User.find({}, 'username userId energy maxEnergy')
      .sort({ energy: -1 })
      .limit(100)
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).json({
        message: 'No users found',
        leaderboard: []
      });
    }

    const leaderboard = users.slice(0, 100).map((user, index) => ({
      rank: index + 1,
      username: user.username,
      userId: user.userId,
      currentEnergy: user.energy,
      maxEnergy: user.maxEnergy,
      energyPercentage: ((user.energy / user.maxEnergy) * 100).toFixed(2)
    }));

    res.status(200).json({
      message: 'Energy leaderboard retrieved successfully',
      leaderboard,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve energy leaderboard',
      error: error.message
    });
  }
};



// Get Check-in Leaderboard
const getCheckInLeaderboard = async (req, res) => {
  try {
    const users = await User.find({}, 'username userId checkInStreak statistics.totalCheckIns checkInPoints')
      .sort({ checkInStreak: -1 })
      .limit(100)
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).json({
        message: 'No users found',
        leaderboard: []
      });
    }

    const leaderboard = users.slice(0, 100).map((user, index) => ({
      rank: index + 1,
      username: user.username,
      userId: user.userId,
      currentStreak: user.checkInStreak || 0,
      totalCheckIns: user.statistics?.totalCheckIns || 0,
      checkInPoints: user.checkInPoints || 0
    }));

    res.status(200).json({
      message: 'Check-in leaderboard retrieved successfully',
      leaderboard,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve check-in leaderboard',
      error: error.message
    });
  }
};

// Get Combined Stats Leaderboard
const getCombinedLeaderboard = async (req, res) => {
  try {
    const users = await User.find({}, 
      'username userId power energy maxEnergy directReferrals referralPoints checkInStreak statistics.totalCheckIns checkInPoints')
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).json({
        message: 'No users found',
        leaderboard: []
      });
    }

    // Calculate total score for each user
    const enhancedUsers = users.map(user => ({
      ...user,
      totalScore: (
        (user.power || 0) + 
        (user.referralPoints || 0) + 
        (user.checkInPoints || 0)
      )
    }));

    // Sort by total score
    enhancedUsers.sort((a, b) => b.totalScore - a.totalScore);

    const leaderboard = enhancedUsers.slice(0, 100).map((user, index) => ({
      rank: index + 1,
      username: user.username,
      userId: user.userId,
      totalScore: user.totalScore,
      breakdown: {
        power: user.power || 0,
        energy: {
          current: user.energy || 0,
          max: user.maxEnergy || 0
        },
        referrals: {
          count: user.directReferrals?.length || 0,
          points: user.referralPoints || 0
        },
        checkIns: {
          streak: user.checkInStreak || 0,
          total: user.statistics?.totalCheckIns || 0,
          points: user.checkInPoints || 0
        }
      }
    }));

    res.status(200).json({
      message: 'Combined leaderboard retrieved successfully',
      leaderboard,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve combined leaderboard',
      error: error.message
    });
  }
};

// Get Referral Leaderboard
const getReferralLeaderboard = async (req, res) => {
  try {
    const users = await User.find({}, 'username userId directReferrals referralPoints')
      .sort({ 'directReferrals.length': -1 })
      .limit(100)
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).json({
        message: 'No users found',
        leaderboard: []
      });
    }

    const leaderboard = users.slice(0, 100).map((user, index) => ({
      rank: index + 1,
      username: user.username,
      userId: user.userId,
      referralCount: user.directReferrals?.length || 0,
      referralPoints: user.referralPoints || 0
    }));

    res.status(200).json({
      message: 'Referral leaderboard retrieved successfully',
      leaderboard,
      totalUsers: users.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve referral leaderboard',
      error: error.message
    });
  }
};

// Export all controller functions
module.exports = {
  registerUser,
  handleTap,
  upgradeLevel,
  monitorUserStatus,
  activateAutoTapBot,
  getAutoBotEarnings,
  getPendingAutoBotEarnings,
  getAutoBotStatus,
  performDailyCheckIn,
  getCheckInStatus,
  getReferralDetails,
  getReferralRewardStatus,
  claimReferralReward,
  getAllUsers,
  getUserStatistics,
  getUserAchievements,
  getPowerLeaderboard,
  getEnergyLeaderboard,
  getReferralLeaderboard,
  getReferralLeaderboard,
  getCheckInLeaderboard,
  getCombinedLeaderboard,
  getEnergyStatus,
  refillEnergy
};