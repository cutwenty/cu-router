# cu-router

路由模块，向 vue-router 学着加了一些生命周期和使用习惯什么的，总觉得还要完善。

## 使用

用路由信息、挂载元素创建路由对象。

	import cuRouter from './utils/cu-router.js';
	import { indexRoute } from 'index.js';
	import { secondRoute } from 'second.js';
	
	// 将根路由重定向到 /index
	cuRouter.redirect('/', '/index');
	
	var router = new cuRouter('#app', {
	  '/index': indexRoute,
	  '/second/:id': secondRoute
	});

路由的详细信息可以放到单独的文件中。

	import template from 'template.html';
	
	var indexRoute = {
	  // name: '', 路由的 name
	  // url: '', 路由挂载的页面
	  template, // 路由挂载的模板
	  controller: {
	    willMount (toMount, next) {
	      var html = compile(toMount.tpl, data);
	      next();
	    },
	    mounted (view) {
	      console.log('mount');
	    },
	    willUnmount (view) {
	      console.log('unmount');
	    }
	  },
	  children: {
	  }
	};
	
	export {indexRoute}

最后，在页面中设置挂载的节点。
	
	<router-view></router-view>
	
	// 有name 属性的节点只挂载相同 name 属性的路由
	<router-view name='index'></router-view>
	
## 生命周期

生命周期学习的是，vue-router 的生命周期管理。

1. willMount
	
	在一个路由挂载之前调用，在这个方法里，要把模板（template 属性）编译成页面，或者直接使用 url 属性获取的页面。
	
	然后，必须使用 next 方法将页面进行装载，和装载下一层路由。

		willMount (toMount, next) {
			next(toMount.tpl);
		}
	
	toMount 参数包含
	1. tpl，模板、页面字符串
	2. query，hash 地址中包含的参数
	3. data，使用 push、replace 方法进行路由跳转时携带的数据。

2. mounted
	
	路由加载到页面中后调用

3. willUnmount

	在卸载一个路由时调用，如果返回 false 会停止卸载。
	
## API

cuRouter.redirect(from, to);
	
注册路由重定向的信息。

router.push({path, query, params, data});

router.replace({path, query, params, data});

类似 history,pushState 和 history.replaceState 方法。

router.go(n);

router.back();

router.forward();