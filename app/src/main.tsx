import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, type Article, type Comment, type Profile, type User, formatDate, imageUrl } from './api';
import './styles.css';

type AuthState = 'authenticated' | 'unauthenticated' | 'unavailable' | 'loading';

declare global {
  interface Window {
    __conduit_debug__?: {
      getToken: () => string | null;
      getAuthState: () => AuthState;
      getCurrentUser: () => User | null;
    };
  }
}

const path = window.location.pathname;
const query = new URLSearchParams(window.location.search);
const avatar = (image: string | null | undefined, className: string) => (
  <img className={className} src={imageUrl(image)} alt="" />
);

function ErrorMessages({ errors }: { errors: Record<string, string[]> }) {
  const messages = Object.entries(errors).flatMap(([field, values]) => values.map(message => `${field} ${message}`));
  return messages.length ? <ul className="error-messages">{messages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul> : null;
}

function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('jwtToken');
    if (!token) {
      setAuthState('unauthenticated');
      return () => { active = false; };
    }
    api<{ user: User }>('/user').then(({ user: current }) => {
      if (!active) return;
      setUser(current);
      setAuthState('authenticated');
    }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        localStorage.removeItem('jwtToken');
        setUser(null);
        setAuthState('unauthenticated');
      } else {
        setAuthState('unavailable');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    window.__conduit_debug__ = {
      getToken: () => localStorage.getItem('jwtToken'),
      getAuthState: () => authState,
      getCurrentUser: () => user,
    };
  }, [authState, user]);

  return { user, setUser, authState, setAuthState };
}

function App() {
  const { user, setUser, authState, setAuthState } = useAuth();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (authState === 'unavailable') setUnavailable(true);
    if (authState === 'authenticated') setUnavailable(false);
  }, [authState]);

  useEffect(() => {
    const protectedRoute = path === '/settings' || path === '/editor' || path.startsWith('/editor/');
    if (authState === 'unauthenticated' && protectedRoute) window.location.replace('/login');
  }, [authState]);

  async function signOut() {
    localStorage.removeItem('jwtToken');
    setUser(null);
    setAuthState('unauthenticated');
    window.location.assign('/');
  }

  const nav = (
    <nav className="navbar">
      <div className="container">
        <a className="navbar-brand" href="/">conduit</a>
        <div className="nav-links">
          <a className="nav-link" href="/">Home</a>
          {user ? <>
            <a className="nav-link" href="/editor"> <span aria-hidden="true">＋</span> New Article</a>
            <a className="nav-link" href="/settings">Settings</a>
            <a className="nav-link user-nav" href={`/profile/${encodeURIComponent(user.username)}`}>
              {avatar(user.image, 'user-pic')}{user.username}
            </a>
          </> : <>
            <a className="nav-link" href="/login">Sign in</a>
            <a className="nav-link" href="/register">Sign up</a>
          </>}
        </div>
      </div>
    </nav>
  );

  let pageContent;
  if (path === '/login' || path === '/register') {
    pageContent = <AuthForm register={path === '/register'} />;
  } else if (path === '/settings') {
    pageContent = user ? <Settings user={user} onUpdate={setUser} onLogout={signOut} /> : <Connecting />;
  } else if (path === '/editor' || path.startsWith('/editor/')) {
    pageContent = user ? <Editor user={user} /> : <Connecting />;
  } else if (path.startsWith('/article/')) {
    pageContent = <ArticlePage slug={decodeURIComponent(path.slice('/article/'.length))} user={user} />;
  } else if (path.startsWith('/profile/')) {
    const segments = path.split('/').filter(Boolean);
    pageContent = <ProfilePage username={decodeURIComponent(segments[1] ?? '')} favorites={segments[2] === 'favorites'} user={user} />;
  } else {
    pageContent = <Home user={user} />;
  }

  return <>
    {nav}
    {unavailable && <div className="connection-status" role="status">Connecting to the server…</div>}
    <main>{pageContent}</main>
    <footer className="site-footer"><div className="container"><a href="/">conduit</a><span>A place to share your knowledge.</span></div></footer>
  </>;
}

function Connecting() {
  return <div className="container page"><p>Connecting to the server…</p></div>;
}

function AuthForm({ register }: { register: boolean }) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    const values = new FormData(event.currentTarget);
    const user = Object.fromEntries(values.entries());
    try {
      const response = await api<{ user: User }>(register ? '/users' : '/users/login', {
        method: 'POST',
        body: JSON.stringify({ user }),
      });
      localStorage.setItem('jwtToken', response.user.token);
      window.location.assign('/');
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['Unable to connect to the server'] });
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="auth-page page container">
    <h1>{register ? 'Sign up' : 'Sign in'}</h1>
    <p><a href={register ? '/login' : '/register'}>{register ? 'Have an account?' : 'Need an account?'}</a></p>
    <ErrorMessages errors={errors} />
    <form onSubmit={submit}>
      {register && <fieldset><input name="username" placeholder="Username" autoComplete="username" required /></fieldset>}
      <fieldset><input name="email" type="email" placeholder="Email" autoComplete="email" required /></fieldset>
      <fieldset><input name="password" type="password" placeholder="Password" autoComplete={register ? 'new-password' : 'current-password'} required /></fieldset>
      <button className="btn btn-primary submit-button" type="submit" disabled={submitting}>{register ? 'Sign up' : 'Sign in'}</button>
    </form>
  </div>;
}

function Home({ user }: { user: User | null }) {
  const pageNumber = Math.max(1, Number(query.get('page') ?? 1) || 1);
  const feed = query.get('feed') === 'following';
  const tag = path.startsWith('/tag/') ? decodeURIComponent(path.slice('/tag/'.length)) : null;
  const [articles, setArticles] = useState<Article[]>([]);
  const [count, setCount] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [errorText, setErrorText] = useState('');
  const [sortOrder, setSortOrder] = useState<'recent' | 'popular'>('recent');

  useEffect(() => {
    if (feed && !user) {
      window.location.replace('/login');
      return;
    }
    const params = new URLSearchParams({ limit: '10', offset: String((pageNumber - 1) * 10) });
    if (tag) params.set('tag', tag);
    api<{ articles: Article[]; articlesCount: number }>(`${feed ? '/articles/feed' : '/articles'}?${params}`)
      .then(result => { setArticles(result.articles); setCount(result.articlesCount); })
      .catch(() => setErrorText('Articles could not be loaded.'));
    api<{ tags: string[] }>('/tags').then(result => setTags(result.tags)).catch(() => setTags([]));
  }, [feed, pageNumber, tag, user]);

  const pageCount = Math.ceil(count / 10);
  const visibleArticles = [...articles].sort((left, right) => sortOrder === 'popular'
    ? right.favoritesCount - left.favoritesCount
    : Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const pageHref = (number: number) => {
    const params = new URLSearchParams();
    if (feed) params.set('feed', 'following');
    if (number > 1) params.set('page', String(number));
    const suffix = params.toString();
    return `${tag ? `/tag/${encodeURIComponent(tag)}` : '/'}${suffix ? `?${suffix}` : ''}`;
  };

  return <>
    {!tag && <section className="banner"><div className="container"><h1>conduit</h1><p>A place to share your knowledge.</p></div></section>}
    <div className="container home-grid">
      <section className="feed-column">
        <div className="feed-controls">
          <div className="feed-toggle">
            <a className={`nav-link ${feed ? '' : !tag ? 'active' : ''}`} href="/">Global Feed</a>
            {user && <a className={`nav-link ${feed ? 'active' : ''}`} href="/?feed=following">Your Feed</a>}
            {tag && <a className="nav-link active" href={`/tag/${encodeURIComponent(tag)}`}>{tag}</a>}
          </div>
          <label className="feed-sort">Sort by
            <select value={sortOrder} onChange={event => setSortOrder(event.currentTarget.value === 'popular' ? 'popular' : 'recent')}>
              <option value="recent">Recent</option>
              <option value="popular">Most Liked</option>
            </select>
          </label>
        </div>
        {errorText && <p role="alert">{errorText}</p>}
        {visibleArticles.length ? visibleArticles.map(article => <ArticlePreview key={article.slug} article={article} user={user} />) :
          <div className="empty-feed-message">{feed ? <>Your feed is empty. <a href="/">Browse the Global Feed</a> to find authors to follow.</> : 'No articles here... yet.'}</div>}
        {pageCount > 1 && <nav className="pagination" aria-label="Article pages">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(number => (
            <div className={`page-item ${number === pageNumber ? 'active' : ''}`} key={number}>
              <a className="page-link" href={pageHref(number)}>{number}</a>
            </div>
          ))}
        </nav>}
      </section>
      <aside className="sidebar">
        <p>Popular Tags</p>
        <div className="tag-list">
          {tags.map(item => <a className="tag-pill" href={`/tag/${encodeURIComponent(item)}`} key={item}>{item}</a>)}
        </div>
      </aside>
    </div>
  </>;
}

function ArticlePreview({ article, user }: { article: Article; user: User | null }) {
  const [favorited, setFavorited] = useState(article.favorited);
  const [favoritesCount, setFavoritesCount] = useState(article.favoritesCount);
  async function toggleFavorite(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!user) {
      window.location.assign('/login');
      return;
    }
    try {
      const result = await api<{ article: Article }>(`/articles/${encodeURIComponent(article.slug)}/favorite`, {
        method: favorited ? 'DELETE' : 'POST',
      });
      setFavorited(result.article.favorited);
      setFavoritesCount(result.article.favoritesCount);
    } catch {
      return;
    }
  }
  return <div className="article-preview">
    <div className="article-meta">
      <a href={`/profile/${encodeURIComponent(article.author.username)}`}>{avatar(article.author.image, 'author-img')}</a>
      <div className="info"><a className="author" href={`/profile/${encodeURIComponent(article.author.username)}`}>{article.author.username}</a><span className="date">{formatDate(article.createdAt)}</span></div>
      <button type="button" className={`btn btn-sm ${favorited ? 'btn-primary' : 'btn-outline-primary'}`} onClick={toggleFavorite} aria-label={`${favorited ? 'Unfavorite' : 'Favorite'} article`}>
        ♥ {favoritesCount}
      </button>
    </div>
    <a className="preview-link" href={`/article/${encodeURIComponent(article.slug)}`}>
      <h1>{article.title}</h1>
      <p>{article.description}</p>
      <span className="read-more">Read more...</span>
    </a>
    <ul className="tag-list preview-tags">{article.tagList.map(item => <li className="tag-default" key={item}>{item}</li>)}</ul>
  </div>;
}

function ProfilePage({ username, favorites, user }: { username: string; favorites: boolean; user: User | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [count, setCount] = useState(0);
  const [errorText, setErrorText] = useState('');
  const ownProfile = user?.username.toLowerCase() === username.toLowerCase();
  useEffect(() => {
    api<{ profile: Profile }>(`/profiles/${encodeURIComponent(username)}`).then(result => setProfile(result.profile))
      .catch(() => setErrorText('Profile could not be loaded.'));
    const params = new URLSearchParams({ limit: '10', offset: '0' });
    if (favorites) params.set('favorited', username);
    else params.set('author', username);
    api<{ articles: Article[]; articlesCount: number }>(`/articles?${params}`).then(result => {
      setArticles(result.articles);
      setCount(result.articlesCount);
    }).catch(() => setErrorText('Articles could not be loaded.'));
  }, [username, favorites]);

  async function toggleFollow() {
    if (!user) {
      window.location.assign('/login');
      return;
    }
    try {
      const result = await api<{ profile: Profile }>(`/profiles/${encodeURIComponent(username)}/follow`, { method: profile?.following ? 'DELETE' : 'POST' });
      setProfile(result.profile);
    } catch {
      setErrorText('The follow action could not be completed.');
    }
  }

  return <div className="profile-page">
    <section className="user-info">
      <div className="container">
        {avatar(profile?.image, 'user-img')}
        <h4>{profile?.username ?? username}</h4>
        <p>{profile?.bio ?? ''}</p>
        {ownProfile ? <a className="btn btn-sm btn-outline-secondary" href="/settings">Edit Profile Settings</a> :
          profile && <button type="button" className={`btn btn-sm ${profile.following ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={toggleFollow}>
            {profile.following ? `Unfollow ${username}` : `Follow ${username}`}
          </button>}
      </div>
    </section>
    <div className="container profile-articles">
      {errorText && <p role="alert">{errorText}</p>}
      <div className="feed-toggle">
        <a className={`nav-link ${favorites ? '' : 'active'}`} href={`/profile/${encodeURIComponent(username)}`}>My Articles</a>
        <a className={`nav-link ${favorites ? 'active' : ''}`} href={`/profile/${encodeURIComponent(username)}/favorites`}>Favorited</a>
      </div>
      {articles.length ? articles.map(article => <ArticlePreview key={article.slug} article={article} user={user} />) :
        <div className="empty-feed-message">{count === 0 ? 'No articles here... yet.' : ''}</div>}
    </div>
  </div>;
}

function ArticlePage({ slug, user }: { slug: string; user: User | null }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [errorText, setErrorText] = useState('');
  useEffect(() => {
    api<{ article: Article }>(`/articles/${encodeURIComponent(slug)}`).then(result => setArticle(result.article))
      .catch(() => setErrorText('Article not found.'));
    api<{ comments: Comment[] }>(`/articles/${encodeURIComponent(slug)}/comments`).then(result => setComments(result.comments))
      .catch(() => setErrorText('Comments could not be loaded.'));
  }, [slug]);

  if (!article) return <div className="container page">{errorText ? <p role="alert">{errorText}</p> : <p>Loading article…</p>}</div>;
  const isAuthor = user?.username === article.author.username;

  async function toggleFavorite() {
    if (!user) {
      window.location.assign('/login');
      return;
    }
    try {
      const result = await api<{ article: Article }>(`/articles/${encodeURIComponent(slug)}/favorite`, { method: article!.favorited ? 'DELETE' : 'POST' });
      setArticle(result.article);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The action failed'] });
    }
  }

  async function toggleFollow() {
    if (!user) {
      window.location.assign('/login');
      return;
    }
    try {
      const result = await api<{ profile: Profile }>(`/profiles/${encodeURIComponent(article!.author.username)}/follow`, { method: article!.author.following ? 'DELETE' : 'POST' });
      setArticle({ ...article!, author: result.profile });
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The action failed'] });
    }
  }

  async function deleteArticle() {
    try {
      await api(`/articles/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      window.location.assign('/');
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The action failed'] });
    }
  }

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ comment: Comment }>(`/articles/${encodeURIComponent(slug)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment: { body: commentBody } }),
      });
      setComments(current => [...current, result.comment]);
      setCommentBody('');
      setErrors({});
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The comment could not be posted'] });
    }
  }

  async function removeComment(id: number) {
    try {
      await api(`/articles/${encodeURIComponent(slug)}/comments/${id}`, { method: 'DELETE' });
      setComments(current => current.filter(comment => comment.id !== id));
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The comment could not be deleted'] });
    }
  }

  return <>
    <header className="article-banner">
      <div className="container">
        <h1>{article.title}</h1>
        <div className="article-meta">
          <a href={`/profile/${encodeURIComponent(article.author.username)}`}>{avatar(article.author.image, 'author-img')}</a>
          <div className="info"><a className="author" href={`/profile/${encodeURIComponent(article.author.username)}`}>{article.author.username}</a><span className="date">{formatDate(article.createdAt)}</span></div>
          {isAuthor ? <>
            <a className="btn btn-sm btn-outline-secondary" href={`/editor/${encodeURIComponent(slug)}`}>Edit Article</a>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={deleteArticle}>Delete Article</button>
          </> : <>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={toggleFollow}>{article.author.following ? 'Unfollow' : 'Follow'} {article.author.username}</button>
            <button type="button" className={`btn btn-sm ${article.favorited ? 'btn-primary' : 'btn-outline-primary'}`} onClick={toggleFavorite}>
              {article.favorited ? 'Unfavorite' : 'Favorite'} Article ({article.favoritesCount})
            </button>
          </>}
        </div>
      </div>
    </header>
    <div className="container article-page page">
      <ErrorMessages errors={errors} />
      <div className="article-content">{article.body?.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <ul className="tag-list">{article.tagList.map(tag => <li className="tag-default" key={tag}>{tag}</li>)}</ul>
      <hr />
      <div className="article-meta">
        <a href={`/profile/${encodeURIComponent(article.author.username)}`}>{avatar(article.author.image, 'author-img')}</a>
        <div className="info"><a className="author" href={`/profile/${encodeURIComponent(article.author.username)}`}>{article.author.username}</a><span className="date">{formatDate(article.createdAt)}</span></div>
      </div>
      <section className="comments">
        {user ? <form className="card comment-form" onSubmit={submitComment}>
          <div className="card-block"><textarea className="form-control" placeholder="Write a comment..." value={commentBody} onChange={event => setCommentBody(event.target.value)} /></div>
          <div className="card-footer">{avatar(user.image, 'comment-author-img')}<button className="btn btn-sm btn-primary" type="submit">Post Comment</button></div>
        </form> : <p>Sign in or sign up to add comments.</p>}
        {comments.map(comment => <div className="card" key={comment.id}>
          <div className="card-block"><p>{comment.body}</p></div>
          <div className="card-footer">{avatar(comment.author.image, 'comment-author-img')}<a className="comment-author" href={`/profile/${encodeURIComponent(comment.author.username)}`}>{comment.author.username}</a><span className="date">{formatDate(comment.createdAt)}</span>
            {user?.username === comment.author.username && <span className="mod-options"><button type="button" aria-label="Delete comment" onClick={() => removeComment(comment.id)}><i className="ion-trash-a">×</i></button></span>}
          </div>
        </div>)}
      </section>
    </div>
  </>;
}

function Editor({ user }: { user: User }) {
  const slug = path.startsWith('/editor/') ? decodeURIComponent(path.slice('/editor/'.length)) : null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!slug) return;
    api<{ article: Article }>(`/articles/${encodeURIComponent(slug)}`).then(({ article }) => {
      if (article.author.username !== user.username) {
        window.location.assign(`/article/${encodeURIComponent(slug)}`);
        return;
      }
      setTitle(article.title);
      setDescription(article.description);
      setBody(article.body ?? '');
      setTags(article.tagList);
    }).catch(() => setErrors({ article: ['not found'] }));
  }, [slug, user.username]);

  function addTag(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) setTags(current => [...current, tag]);
    setTagInput('');
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const result = await api<{ article: Article }>(slug ? `/articles/${encodeURIComponent(slug)}` : '/articles', {
        method: slug ? 'PUT' : 'POST',
        body: JSON.stringify({ article: { title, description, body, tagList: tags } }),
      });
      window.location.assign(`/article/${encodeURIComponent(result.article.slug)}`);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['The article could not be saved'] });
    }
  }

  return <div className="container page editor-page">
    <ErrorMessages errors={errors} />
    <form onSubmit={publish}>
      <fieldset><input name="title" placeholder="Article Title" value={title} onChange={event => setTitle(event.target.value)} required /></fieldset>
      <fieldset><input name="description" placeholder="What's this article about?" value={description} onChange={event => setDescription(event.target.value)} required /></fieldset>
      <fieldset><textarea name="body" placeholder="Write your article (in markdown)" value={body} onChange={event => setBody(event.target.value)} required /></fieldset>
      <fieldset className="tag-input"><input placeholder="Enter tags" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={addTag} />
        <div className="tag-list">{tags.map(tag => <span className="tag-pill" key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => setTags(current => current.filter(item => item !== tag))}><i>×</i></button></span>)}</div>
      </fieldset>
      <button className="btn btn-primary submit-button" type="submit">Publish Article</button>
    </form>
  </div>;
}

function Settings({ user, onUpdate, onLogout }: { user: User; onUpdate: (user: User) => void; onLogout: () => void }) {
  const [bio, setBio] = useState(user.bio ?? '');
  const [image, setImage] = useState(user.image ?? '');
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setBio(user.bio ?? '');
    setImage(user.image ?? '');
    setUsername(user.username);
    setEmail(user.email);
  }, [user]);

  async function update(event: React.FormEvent) {
    event.preventDefault();
    const updateUser: Record<string, string> = { username, email, bio, image };
    if (password) updateUser.password = password;
    try {
      const result = await api<{ user: User }>('/user', { method: 'PUT', body: JSON.stringify({ user: updateUser }) });
      localStorage.setItem('jwtToken', result.user.token);
      onUpdate(result.user);
      window.location.assign(`/profile/${encodeURIComponent(result.user.username)}`);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.errors : { server: ['Settings could not be saved'] });
    }
  }

  return <div className="container settings-page page">
    <h1>Your Settings</h1>
    <ErrorMessages errors={errors} />
    <form onSubmit={update}>
      <fieldset><input name="image" placeholder="URL of profile picture" value={image} onChange={event => setImage(event.target.value)} /></fieldset>
      <fieldset><input name="username" placeholder="Your Name" value={username} onChange={event => setUsername(event.target.value)} required /></fieldset>
      <fieldset><textarea name="bio" placeholder="Short bio about you" value={bio} onChange={event => setBio(event.target.value)} /></fieldset>
      <fieldset><input name="email" type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required /></fieldset>
      <fieldset><input name="password" type="password" placeholder="New Password" value={password} onChange={event => setPassword(event.target.value)} /></fieldset>
      <button className="btn btn-primary submit-button" type="submit">Update Settings</button>
    </form>
    <hr />
    <button className="btn btn-outline-danger" type="button" onClick={onLogout}>Or click here to logout</button>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
