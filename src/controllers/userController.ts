import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models/User';

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;
    
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (name) user.name = name;
    if (email) user.email = email;

    await user.save();
    
    const updatedUser = await User.findById(req.userId).select('-passwordHash');
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findByIdAndDelete(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
