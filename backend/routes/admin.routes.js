const express = require('express');
const User = require('../models/User');
const Job = require('../models/Job');
const Course = require('../models/Course');
const Skill = require('../models/Skill');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes in this router require admin role
router.use(protect, authorize('admin'));

/**
 * @route   GET /api/admin/overview
 * @desc    Get comprehensive admin overview metrics
 * @access  Private (Admin)
 */
router.get('/overview', async (req, res) => {
  try {
    const [
      totalStudents,
      totalRecruiters,
      totalCollegeAdmins,
      totalAdmins,
      totalJobs,
      activeJobs,
      totalCourses,
      recentUsers,
      recentJobs
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'college_admin' }),
      User.countDocuments({ role: 'admin' }),
      Job.countDocuments(),
      Job.countDocuments({ status: 'active' }),
      Course.countDocuments({ isActive: true }),
      User.find()
        .select('name email role createdAt metrics.skillReadinessScore')
        .sort({ createdAt: -1 })
        .limit(6),
      Job.find()
        .select('title company type location status createdAt applicants')
        .sort({ createdAt: -1 })
        .limit(6)
    ]);

    const totalUsers = totalStudents + totalRecruiters + totalCollegeAdmins + totalAdmins;

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalStudents,
          totalRecruiters,
          totalCollegeAdmins,
          totalAdmins,
          totalJobs,
          activeJobs,
          totalCourses
        },
        recentUsers,
        recentJobs: recentJobs.map(j => ({
          _id: j._id,
          title: j.title,
          company: j.company?.name || 'Company',
          type: j.type,
          status: j.status,
          applicantsCount: (j.applicants || []).length,
          createdAt: j.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin overview',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/users
 * @desc    List all platform users with filtering and search
 * @access  Private (Admin)
 */
router.get('/users', async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('name email role createdAt phone location company college metrics skills')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/users
 * @desc    Create a user with specified role
 * @access  Private (Admin)
 */
router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, companyName, collegeName } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and role are required'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    const userData = {
      name,
      email,
      password,
      role
    };

    if (role === 'recruiter') {
      userData.company = { name: companyName || 'Company' };
    } else if (role === 'college_admin') {
      userData.college = { name: collegeName || 'College' };
    }

    const newUser = await User.create(userData);

    res.status(201).json({
      success: true,
      message: `User created successfully with role ${role}`,
      data: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/users/:id/role
 * @desc    Change user role
 * @access  Private (Admin)
 */
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ['student', 'recruiter', 'college_admin', 'admin'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${allowedRoles.join(', ')}`
      });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent changing own role away from admin
    if (targetUser._id.toString() === req.user._id.toString() && role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot demote your own administrator account'
      });
    }

    targetUser.role = role;
    await targetUser.save();

    res.json({
      success: true,
      message: `User role updated to ${role}`,
      data: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role
      }
    });
  } catch (error) {
    console.error('Admin update role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user role',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete a user
 * @access  Private (Admin)
 */
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own admin account'
      });
    }

    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/jobs
 * @desc    Get all jobs across the platform
 * @access  Private (Admin)
 */
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await Job.find()
      .populate('postedBy', 'name email company')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Admin get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/jobs
 * @desc    Post a job directly as admin
 * @access  Private (Admin)
 */
router.post('/jobs', async (req, res) => {
  try {
    const {
      title,
      companyName,
      companyWebsite,
      locationCity,
      type,
      mode,
      description,
      requiredSkills,
      salaryMin,
      salaryMax
    } = req.body;

    if (!title || !companyName || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title, company name, and description are required'
      });
    }

    const skillsArray = Array.isArray(requiredSkills)
      ? requiredSkills
      : (requiredSkills || '').split(',').map(s => ({
          name: s.trim(),
          importance: 'required',
          minLevel: 60
        })).filter(s => s.name);

    const newJob = await Job.create({
      title,
      company: {
        name: companyName,
        website: companyWebsite || ''
      },
      location: {
        city: locationCity || 'Bangalore',
        state: 'Karnataka',
        country: 'India',
        remote: mode === 'remote'
      },
      type: type || 'full-time',
      mode: mode || 'hybrid',
      description,
      skills: skillsArray,
      salary: {
        min: salaryMin ? parseInt(salaryMin) : 500000,
        max: salaryMax ? parseInt(salaryMax) : 1000000,
        currency: 'INR'
      },
      postedBy: req.user._id,
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Job posted successfully',
      data: newJob
    });
  } catch (error) {
    console.error('Admin post job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post job',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/jobs/:id/status
 * @desc    Toggle job status
 * @access  Private (Admin)
 */
router.put('/jobs/:id/status', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    job.status = job.status === 'active' ? 'closed' : 'active';
    await job.save();

    res.json({
      success: true,
      message: `Job status changed to ${job.status}`,
      data: job
    });
  } catch (error) {
    console.error('Admin update job status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job status',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/admin/jobs/:id
 * @desc    Delete a job
 * @access  Private (Admin)
 */
router.delete('/jobs/:id', async (req, res) => {
  try {
    const deleted = await Job.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete job',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/courses
 * @desc    Get all courses for admin
 * @access  Private (Admin)
 */
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Admin get courses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/courses
 * @desc    Create a course
 * @access  Private (Admin)
 */
router.post('/courses', async (req, res) => {
  try {
    const { title, description, category, provider, level, duration } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and category are required'
      });
    }

    const course = await Course.create({
      title,
      description,
      category,
      provider: {
        name: provider || 'SkillForge Academy'
      },
      level: level || 'beginner',
      duration: {
        totalHours: duration ? parseInt(duration) : 20
      },
      isActive: true
    });

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: course
    });
  } catch (error) {
    console.error('Admin create course error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create course',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/admin/courses/:id
 * @desc    Delete a course
 * @access  Private (Admin)
 */
router.delete('/courses/:id', async (req, res) => {
  try {
    const deleted = await Course.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete course error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete course',
      error: error.message
    });
  }
});

module.exports = router;
