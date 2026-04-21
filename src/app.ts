import express from 'express';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { authRoutes } from './routes/authRoutes';
import { userRoutes } from './routes/userRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Server is running');
});

const startServer = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/express-auth';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
};

startServer();

export { app };
