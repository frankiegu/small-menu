const express = require('express');
const multer  = require('multer');
const qiniu = require('qiniu');
const path = require('path');

const router = express.Router();
const { User, Menu, Article } = require('../models/index');
const { PLEASE_LOGIN, GENDER_ERROR, UPDATE_SUCCESS, QINIU_DOMAIN } = require('../utilities/const');
const upload = multer({ 
	dest: 'uploads/',
	limits: {
		fileSize: 1024 * 1024
	}
});

router.get('/', function(req, res) {
	res.locals.users = [];
	User.findAll().then(users => {
		if (users.length === 0) {
			res.render('chart');
		} else {
			users.map((value, index) => {
				res.locals.users.push(users[index].dataValues);
				users[index].getFollowers().then((followers) => {
					res.locals.users[index].followers = followers.length;
					users[index].getFollowing().then((following => {
						res.locals.users[index].following = following.length;
						if (index === users.length - 1) {
							res.render('chart');
						}
					}));
				});
			});
		}
	});
});

router.get('/setting', function(req, res) {
	if (!req.session.user) {
		req.flash('error', PLEASE_LOGIN);
		res.redirect('/');
	} else {
		User.findById(parseInt(req.session.user.id)).then(user => {
			if (!user) {
				req.flash('error', PLEASE_LOGIN);
				res.redirect('/');
			} else {
				res.render('setting');
			}
		});
	}
});

router.post('/setting', upload.single('avatar'), function(req, res) {
	const { username, gender, intro} = req.body;

	if (!req.session.user) {
		req.flash('error', PLEASE_LOGIN);
		res.redirect('/login');
	} else if (gender !== '男' && gender !== '女') {
		req.flash('error', GENDER_ERROR);
		res.redirect('/user/setting');
	} else if (typeof req.file === 'undefined') {
		const intGender = gender === '男' ? 1 : 0;
		User.update({
			username,
			gender: intGender,
			intro
		}, {
			where: { id: parseInt(req.session.user.id) }
		}).then(() => {
			User.findById(req.session.user.id).then(user => {
				req.session.user.username = user.dataValues.username;
				req.session.user.gender = user.dataValues.gender;
				req.session.user.intro = user.dataValues.intro;
				
				req.flash('info', UPDATE_SUCCESS);
				res.redirect('/user/0');
			});
		});
	} else {
		const intGender = gender === '男' ? 1 : 0;
		const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);

		let config = new qiniu.conf.Config();
		config.zone = qiniu.zone.Zone_z2;
		
		const localFile = path.join(__dirname, '..', req.file.path);
		
		const formUploader = new qiniu.form_up.FormUploader(config);
		const putExtra = new qiniu.form_up.PutExtra();
		
		const keyToOverwrite = `avatar/${req.file.filename}.jpg`;
		const options = {
			scope: `${process.env.QINIU_BUCKET}:${keyToOverwrite}`
		};
		const putPolicy = new qiniu.rs.PutPolicy(options);
		const uploadToken = putPolicy.uploadToken(mac);

		formUploader.putFile(uploadToken, keyToOverwrite, localFile, putExtra, (respErr, respBody, respInfo) => {
			if (respErr) {
				throw respErr;
			}
			if (respInfo.statusCode == 200) {
				User.update({
					username,
					gender: intGender,
					avatar: QINIU_DOMAIN + keyToOverwrite,
					intro
				}, {
					where: { id: parseInt(req.session.user.id) }
				}).then(() => {
					User.findById(req.session.user.id).then(user => {
						req.session.user.username = user.dataValues.username;
						req.session.user.gender = user.dataValues.gender;
						req.session.user.intro = user.dataValues.intro;
						req.session.user.avatar = user.dataValues.avatar;
						
						req.flash('info', UPDATE_SUCCESS);
						res.redirect('/user/0');
					});
				});
			} else {
				req.flash('info', UPDATE_SUCCESS);
				res.redirect('back');
			}
		});
	}
});

router.get('/0', function(req, res) {
	res.locals.followingDisabled = false;

	if (req.session.user) {
		req.session.user.following.map(value => {
			if (value.id === req.session.user.id) {
				res.locals.followingDisabled = true;
			}
		});
		res.locals.removeVisiable = true;

		res.render('user');

	} else {
		req.flash('error', '请先登录！');
		res.redirect('/login');
	}
});

router.get('/:id', function(req, res) {
	const { id } = req.params;
	res.locals.followingDisabled = false;

	if (req.session.user) {
		req.session.user.following.map(value => {
			if (value.id === parseInt(id)) {
				res.locals.followingDisabled = true;
			}
		});
	}

	User.findById(id)
		.then(user => {
			if (!user) {
				req.flash('error', '用户不存在！');
				res.redirect('/user');
			} else {
				res.locals.currentUser = user.dataValues;
				res.locals.currentUser.following = [];
				res.locals.currentUser.followers = [];
				res.locals.currentUser.comments = [];
				res.locals.currentUser.collections = [];
				res.locals.currentUser.collectedArticles = [];
				res.locals.currentUser.articles = [];
				res.locals.currentUser.articleComments = [];

				user.getMenus().then(menus => {
					menus.map((value, index) => {
						res.locals.currentUser.collections.push(menus[index]);
					});
					res.locals.removeVisiable = false;
					user.getFollowing().then(followings => {
						followings.map((value) => {
							res.locals.currentUser.following.push(value);
						});
						user.getFollowers().then(followers => {
							followers.map((value) => {
								res.locals.currentUser.followers.push(value);
							});

							user.getArticles().then(collectedArticles => {
								collectedArticles.map(value => {
									res.locals.currentUser.collectedArticles.push(value.dataValues);
								});
								Article.findAll({
									where: { userId: res.locals.currentUser.id}
								}).then(articles => {
									articles.map(value => {
										res.locals.currentUser.articles.push(value.dataValues);
									});
									user.getArticleComments().then(articleComments => {
										if (articleComments.length === 0) {
											user.getComments().then(comments => {
												if (comments.length === 0) {
													res.render('user');
												} else {
													comments.map((value, index) => {
														res.locals.currentUser.comments[index] = comments[index].dataValues;
														Menu.findById(comments[index].menuId).then(menu => {
															res.locals.currentUser.comments[index].menu = menu.dataValues;
															if (index === comments.length - 1) {
																res.render('user');
															}
														});
													});
												}
											});
										} else {
											articleComments.map((value, index) => {
												res.locals.currentUser.articleComments.push(articleComments[index].dataValues);
												Article.findById(articleComments[index].articleId).then(article => {
													res.locals.currentUser.articleComments[index].article = article.dataValues;
													if (index === articleComments.length - 1) {
														user.getComments().then(comments => {
															if (comments.length === 0) {
																res.render('user');
															} else {
																comments.map((value, index) => {
																	res.locals.currentUser.comments[index] = comments[index].dataValues;
																	Menu.findById(comments[index].menuId).then(menu => {
																		res.locals.currentUser.comments[index].menu = menu.dataValues;
																		if (index === comments.length - 1) {
																			res.render('user');
																		}
																	});
																});
															}
														});
													}
												});
											});
										}
									});
								});
							});

						});
					});
				});
			}
		});
});

module.exports = router;