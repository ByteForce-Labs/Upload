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