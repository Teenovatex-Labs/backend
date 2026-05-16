Language: TypeScript

Runtime: Node.js / Express

Database: MongoDB (Mongoose)


-- One-time admin promotion
UPDATE users
SET role = 'admin'
WHERE email = 'your@email.com';