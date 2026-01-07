# WDP Eyewear Shop - Backend API

> **E-commerce system for eyewear with ready stock, pre-order, and prescription orders**

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.16.1-blue.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green.svg)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 📋 Table of Contents

- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [GitHub Workflow Rules](#github-workflow-rules)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 18.x
- **Framework**: Express.js 4.16.1
- **Database**: MongoDB Atlas (Thailand region)
- **ODM**: Mongoose 9.x
- **Authentication**: JWT + bcryptjs
- **Validation**: express-validator
- **Security**: Helmet, CORS, Rate Limiting
- **Documentation**: Swagger UI / OpenAPI 3.0
- **Development**: Nodemon, dotenv

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
npm >= 9.0.0
```

### Installation

```bash
# Clone repository
git clone https://github.com/datfullstacks/wdp-eyewear-backend.git
cd wdp-eyewear-backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev
```

Server will run on: `http://localhost:3000`

### Available Scripts

```bash
npm start        # Production mode
npm run dev      # Development with nodemon
npm test         # Run tests (coming soon)
```

---

## 📁 Project Structure

```
backend/
├── bin/
│   └── www                 # Server entry point
├── config/
│   ├── database.js         # MongoDB connection
│   ├── cors.js            # CORS configuration
│   └── swagger.js         # Swagger/OpenAPI setup
├── constants/
│   └── index.js           # USER_ROLES, HTTP_STATUS, etc.
├── controllers/
│   ├── authController.js  # Auth endpoints
│   └── userController.js  # User CRUD
├── services/
│   ├── authService.js     # Auth business logic
│   └── userService.js     # User business logic
├── models/
│   └── User.js            # User schema
├── middlewares/
│   ├── auth.js            # JWT verification
│   ├── validator.js       # Input validation
│   └── rateLimiter.js     # API rate limiting
├── validators/
│   └── userValidator.js   # Validation rules
├── routes/
│   ├── auth.js            # Auth routes
│   └── users.js           # User routes
├── helpers/
│   ├── asyncHandler.js    # Error wrapper
│   └── response.js        # API responses
├── errors/
│   ├── AppError.js        # Custom error class
│   └── errorHandler.js    # Global error handler
├── .env.example           # Environment template
├── .gitignore
├── app.js                 # Express app
└── package.json
```

**Architecture**: 3-Layer (Controllers → Services → Models)

---

## 📚 API Documentation

**Swagger UI**: `http://localhost:3000/api-docs`

### Authentication Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register new user | ❌ |
| POST | `/api/auth/login` | User login | ❌ |
| GET | `/api/auth/me` | Get current user | ✅ |

### User Management

| Method | Endpoint | Description | Auth | Role |
|--------|----------|-------------|------|------|
| GET | `/api/users` | Get all users | ✅ | admin |
| GET | `/api/users/:id` | Get user by ID | ✅ | admin |
| POST | `/api/users` | Create user | ✅ | admin |
| PUT | `/api/users/:id` | Update user | ✅ | admin |
| DELETE | `/api/users/:id` | Delete user | ✅ | admin |

**User Roles**: `customer`, `sales`, `operations`, `manager`, `admin`

---

## 🔀 GitHub Workflow Rules

### Branch Strategy

```
main (production)
  ↑
develop (staging)
  ↑
feature/* (development)
```

### 1. Branch Naming Convention

```bash
# Features
feature/user-authentication
feature/product-catalog
feature/order-processing

# Bug fixes
bugfix/fix-login-error
bugfix/cors-issue

# Hotfixes (urgent production fixes)
hotfix/security-patch
hotfix/payment-bug

# Refactoring/Improvements
refactor/optimize-queries
chore/update-dependencies
```

### 2. Commit Message Standards

**Format**: `<type>(<scope>): <subject>`

```bash
# Types:
feat:     # New feature
fix:      # Bug fix
docs:     # Documentation only
style:    # Code style (formatting, no logic change)
refactor: # Code refactoring
perf:     # Performance improvement
test:     # Adding tests
chore:    # Maintenance tasks

# Examples:
git commit -m "feat(auth): implement JWT authentication"
git commit -m "fix(user): resolve pagination bug"
git commit -m "docs(readme): add API documentation"
git commit -m "refactor(service): optimize user service"
```

### 3. Pull Request Rules

#### **Before Creating PR:**

```bash
# 1. Update from develop
git checkout develop
git pull origin develop

# 2. Create feature branch
git checkout -b feature/your-feature-name

# 3. Make changes and commit
git add .
git commit -m "feat(scope): description"

# 4. Push to remote
git push origin feature/your-feature-name
```

#### **PR Requirements:**

✅ **Must have**:
- Clear title: `[Feature] Add user authentication`
- Description: What, Why, How
- Screenshots (if UI changes)
- Linked issue: `Closes #123`
- All tests pass
- No merge conflicts

✅ **PR Template**:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Documentation

## Testing
- [ ] Manual testing done
- [ ] No errors in console
- [ ] API tested with Postman

## Checklist
- [ ] Code follows project style
- [ ] Self-reviewed code
- [ ] Commented complex logic
- [ ] Updated documentation
```

#### **Review Process:**

1. **Minimum 1 approval** required
2. **Code reviewer checks**:
   - Code quality and standards
   - Security issues
   - Performance concerns
   - Test coverage
3. **Merge only after approval**

### 4. Merging Strategy

```bash
# Prefer Squash and Merge for feature branches
# This keeps main/develop history clean

# After merge, delete feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

### 5. Protected Branch Rules

**For `main` branch:**
- ❌ No direct commits
- ✅ Require pull request
- ✅ Require 1+ approval
- ✅ Status checks must pass
- ✅ Branch must be up to date

**For `develop` branch:**
- ❌ No direct commits
- ✅ Require pull request
- ✅ Status checks must pass

### 6. Daily Workflow

```bash
# Start of day: Update local develop
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/new-feature

# Work and commit regularly
git add .
git commit -m "feat(scope): what you did"

# Before pushing: Update from develop
git checkout develop
git pull origin develop
git checkout feature/new-feature
git merge develop  # RECOMMENDED for team work - safer than rebase

# Push and create PR
git push origin feature/new-feature
# Then create PR on GitHub
```

### 7. Conflict Resolution

```bash
# If conflicts during rebase/merge:
# 1. Resolve conflicts in files
# 2. Mark as resolved
git add .
git rebase --continue  # or git merge --continue

# If too messy, abort and ask for help
git rebase --abort
```

### 8. Code Review Checklist

**For Reviewers:**

- [ ] Code follows project structure
- [ ] No hardcoded values
- [ ] Proper error handling
- [ ] Security best practices
- [ ] No console.logs in production
- [ ] Environment variables used correctly
- [ ] Comments for complex logic
- [ ] API documentation updated

**For Authors:**

- [ ] Self-reviewed before PR
- [ ] Tested locally
- [ ] No .env committed
- [ ] .gitignore updated if needed
- [ ] README updated if needed

### 9. Emergency Hotfix Process

```bash
# Create hotfix from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug

# Fix and test thoroughly
git add .
git commit -m "hotfix: fix critical production bug"

# Create PR to main AND develop
git push origin hotfix/critical-bug
# PR to main (deploy immediately)
# PR to develop (keep in sync)
```

### 10. Don'ts ❌

- ❌ Never commit to `main` or `develop` directly
- ❌ Never force push to shared branches (`git push -f`)
- ❌ Never commit `.env` files
- ❌ Never commit `node_modules/`
- ❌ Never merge your own PR without review
- ❌ Never leave console.logs in production code
- ❌ Never hardcode credentials or API keys
- ❌ **Never use `git rebase` when working in a team** (use `git merge` instead)

### 11. Team Work Best Practices ⭐

**When working with a team, ALWAYS use `merge` instead of `rebase`:**

```bash
# ✅ RECOMMENDED for team projects:
git checkout feature/your-feature
git merge develop  # Safe, preserves history

# ❌ AVOID in team projects:
git rebase develop  # Can cause conflicts for teammates
```

**Why merge for teams?**
- ✅ Doesn't rewrite shared history
- ✅ Teammates won't have conflicts
- ✅ Safer for collaboration
- ✅ GitHub's "Squash and merge" keeps `main` clean anyway

**Rebase is only OK when:**
- Working alone on a feature branch
- Branch hasn't been pushed yet
- You're absolutely sure no one else is using the branch

---

## 🔐 Environment Variables

See [.env.example](.env.example) for all required variables.

**Critical variables:**

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_super_secret_key
FRONTEND_URL=http://localhost:3000
```

**Never commit `.env` to repository!**

---

## 🚀 Deployment

### DigitalOcean App Platform

1. **Push to GitHub**
   ```bash
   git push origin main
   ```

2. **App Platform will auto-deploy** when `main` branch updates

3. **Environment variables** are set in App Platform dashboard

### Manual Deployment Check

```bash
# Test production build locally
NODE_ENV=production npm start

# Check API health
curl http://localhost:3000/api/health
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'feat(scope): Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 📝 License

This project is licensed under the MIT License.

---

## 👥 Team

**WDP Spring 2026** - Web Development Project

---

## 📞 Support

For issues and questions:
- Create GitHub Issue
- Email: support@wdp-eyewear.com

---

**Last Updated**: January 2026
